import { z } from "zod";
import { contestPhase } from "@/lib/contests/types";
import { formatDuration } from "@/lib/utils";
import {
  assignRanks,
  isAccepted,
  submissionsInWindow,
  type Ruleset,
  type StandingsInput,
  type StandingsRow,
} from "@/lib/standings/types";

const configSchema = z.object({
  penaltyMinutes: z.number().nonnegative().default(20),
});

export interface AcmCell {
  attempts: number;
  /** Minutes from contest start, or null if unsolved. */
  solvedAt: number | null;
  /**
   * Attempts whose outcome the board is not showing: made after the freeze, or
   * simply not judged yet.
   *
   * The two are one number because they are one thing to the person reading
   * the board — something was sent and the result is not in — and because the
   * ICPC convention this cell imitates has always covered both. Counting only
   * the post-freeze half leaves a queued submission showing as nothing at all
   * and then appearing as a solve out of nowhere.
   */
  pending: number;
}

function AcmCellView({ cell }: { cell: AcmCell | undefined }) {
  if (!cell || (cell.attempts === 0 && cell.pending === 0)) {
    return <span className="text-fg-subtle">·</span>;
  }

  // A cell holding nothing but pending attempts is the ordinary case — any
  // queued submission produces one — so the rejected count is dropped rather
  // than printed as `−0`.
  if (cell.solvedAt === null) {
    return (
      <span className="font-mono text-xs tabular-nums">
        {cell.attempts > 0 ? (
          <span className="text-err">−{cell.attempts}</span>
        ) : null}
        {cell.pending > 0 ? (
          <span className="text-info">+{cell.pending}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="text-ok inline-flex flex-col items-center font-mono text-xs leading-tight tabular-nums">
      <span>+{cell.attempts > 1 ? cell.attempts - 1 : ""}</span>
      <span className="text-fg-subtle text-[10px]">
        {formatDuration(cell.solvedAt * 60_000)}
      </span>
    </span>
  );
}

/**
 * ICPC scoring: rank by problems solved, break ties on accumulated penalty
 * (solve time plus a fixed charge per prior rejected attempt).
 */
export const ruleset: Ruleset<AcmCell> = {
  id: "acm",
  name: "ACM / ICPC",
  description: "按通过题数排名，同数按罚时（解题时间 + 错误提交罚分）排序。",
  supportsFreeze: true,

  computeStandings(input: StandingsInput) {
    const { penaltyMinutes } = configSchema.parse(input.config ?? {});
    const start = input.contest.startsAt.getTime();
    const freezeAt = input.contest.freezeAt;
    // Asked rather than recomputed. `content/` gets none of the
    // exhaustive-switch safety the kernel's phase callers have, so a ruleset
    // spelling out `[freezeAt, endsAt]` for itself is a second definition of
    // the window that can disagree with `contestPhase` by a millisecond — the
    // badge saying frozen above a board that is not.
    //
    // Rebuilt rather than passed straight through because `ContestWindow`
    // spells an absent freeze as `null` and `ContestClock` as `undefined`. The
    // instant is `new Date(Date.now())` rather than `new Date()` because
    // `Date.now` is what a test moves to place the board inside a window — see
    // `lib/standings/freeze.test.ts`.
    const frozen =
      contestPhase(
        {
          startsAt: input.contest.startsAt,
          endsAt: input.contest.endsAt,
          freezeAt: freezeAt ?? undefined,
        },
        new Date(Date.now()),
      ) === "frozen";

    const byUser = new Map<string, Map<string, AcmCell>>();
    for (const participant of input.participants) {
      byUser.set(participant.handle, new Map());
    }

    // Everything in the window rather than only what has a verdict, because
    // this format has a cell state for "no verdict yet" and the scored set
    // cannot express it. `isAccepted` still decides the solves, and it answers
    // no for anything unjudged, so the two halves cannot disagree.
    for (const submission of submissionsInWindow(input)) {
      const cells = byUser.get(submission.handle);
      if (!cells) continue;

      const cell = cells.get(submission.problemSlug) ?? {
        attempts: 0,
        solvedAt: null,
        pending: 0,
      };
      cells.set(submission.problemSlug, cell);

      // Once solved, later submissions on that problem are irrelevant.
      if (cell.solvedAt !== null) continue;

      // Withheld by the freeze, or not judged yet. Both are the same statement
      // to a reader — an attempt exists and its outcome is not being shown —
      // and neither may move the total or the penalty, since doing so would
      // announce the result the cell is declining to give.
      const withheld =
        frozen && freezeAt !== null && submission.createdAt >= freezeAt;
      if (withheld || submission.state !== "completed") {
        cell.pending += 1;
        continue;
      }

      cell.attempts += 1;
      if (isAccepted(submission)) {
        cell.solvedAt = Math.floor(
          (submission.createdAt.getTime() - start) / 60_000,
        );
      }
    }

    const rows = input.participants.map((participant) => {
      const cells = Object.fromEntries(byUser.get(participant.handle) ?? []);
      let solved = 0;
      let penalty = 0;

      for (const cell of Object.values(cells)) {
        if (cell.solvedAt === null) continue;
        solved += 1;
        penalty += cell.solvedAt + penaltyMinutes * (cell.attempts - 1);
      }

      return { participant, total: solved, tiebreak: penalty, cells };
    });

    return {
      rows: assignRanks<AcmCell>(rows),
      totalLabel: "解题",
      frozen,
    };
  },

  render: {
    Cell: AcmCellView,
    Total: ({ row }: { row: StandingsRow<AcmCell> }) => (
      <span className="inline-flex flex-col items-center leading-tight">
        <span className="text-fg font-mono font-semibold tabular-nums">
          {row.total}
        </span>
        <span className="text-fg-subtle font-mono text-[10px] tabular-nums">
          {row.tiebreak}
        </span>
      </span>
    ),
  },
};
