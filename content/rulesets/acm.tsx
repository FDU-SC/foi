import { z } from "zod";
import { formatDuration } from "@/lib/utils";
import {
  assignRanks,
  isAccepted,
  scoredSubmissions,
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
  /** Attempts made after the freeze, shown as pending. */
  pending: number;
}

function AcmCellView({ cell }: { cell: AcmCell | undefined }) {
  if (!cell || (cell.attempts === 0 && cell.pending === 0)) {
    return <span className="text-fg-subtle">·</span>;
  }

  if (cell.solvedAt === null) {
    return (
      <span className="text-err font-mono text-xs tabular-nums">
        −{cell.attempts}
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
    const now = Date.now();
    const freezeAt = input.contest.freezeAt;
    const frozen =
      freezeAt !== null && now >= freezeAt.getTime() && now < input.contest.endsAt.getTime();

    const byUser = new Map<string, Map<string, AcmCell>>();
    for (const participant of input.participants) {
      byUser.set(participant.handle, new Map());
    }

    for (const submission of scoredSubmissions(input)) {
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

      if (frozen && freezeAt && submission.createdAt >= freezeAt) {
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
