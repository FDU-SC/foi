import { z } from "zod";
import {
  assignRanks,
  scoredSubmissions,
  type Ruleset,
  type StandingsInput,
  type StandingsRow,
} from "@/lib/standings/types";

const configSchema = z.object({
  /** "best" scores the highest submission, "last" scores the final one. */
  take: z.enum(["best", "last"]).default("best"),
});

export interface OiCell {
  score: number;
  maxScore: number;
  attempts: number;
  /** Milliseconds from contest start for the submission that counted. */
  at: number | null;
}

function OiCellView({ cell }: { cell: OiCell | undefined }) {
  if (!cell || cell.attempts === 0) {
    return <span className="text-fg-subtle">·</span>;
  }

  const full = cell.score >= cell.maxScore;
  const zero = cell.score <= 0;
  const tone = full ? "text-ok" : zero ? "text-err" : "text-partial";

  return (
    <span className={`font-mono text-xs font-medium tabular-nums ${tone}`}>
      {Math.round(cell.score)}
    </span>
  );
}

/**
 * OI scoring: sum per-problem scores, taking each problem's best (or last)
 * submission. Ties break on how early the deciding submissions came in.
 */
export const ruleset: Ruleset<OiCell> = {
  id: "oi",
  name: "OI",
  description: "每题取最高分（或最后一次提交），按总分排名。",
  // Not implemented. A frozen score-based board would need a way to say "this
  // cell has a newer submission you cannot see", and this format has no such
  // cell state; adding one is a change to the format, not a flag flip.
  supportsFreeze: false,

  computeStandings(input: StandingsInput) {
    const { take } = configSchema.parse(input.config ?? {});
    const start = input.contest.startsAt.getTime();

    // What a problem is worth on *this* board, which is not what the backend
    // scored it out of. A contest may reweight a problem with `points`, and
    // the backend knows nothing about that — so the raw score is rescaled
    // below rather than dropped into a column with a different denominator.
    // Getting this wrong showed up as full marks reading "100/200".
    const worth = new Map(
      input.problems.map((problem) => [
        problem.slug,
        problem.points ?? problem.maxScore,
      ]),
    );

    const byUser = new Map<string, Map<string, OiCell>>();
    for (const participant of input.participants) {
      byUser.set(participant.handle, new Map());
    }

    for (const submission of scoredSubmissions(input)) {
      const cells = byUser.get(submission.handle);
      if (!cells) continue;

      const maxScore = worth.get(submission.problemSlug) ?? 0;
      const cell = cells.get(submission.problemSlug) ?? {
        score: 0,
        maxScore,
        attempts: 0,
        at: null,
      };
      cells.set(submission.problemSlug, cell);
      cell.attempts += 1;

      // A backend that reported no score at all counts as zero rather than as
      // no attempt: the person did submit, and a scored format has nothing
      // else to say about a submission it cannot score.
      const raw = submission.score ?? 0;
      const outOf = submission.maxScore;
      const score =
        outOf && outOf > 0 && outOf !== maxScore
          ? (raw / outOf) * maxScore
          : raw;

      // Submissions arrive oldest first, so "last" simply overwrites and
      // "best" keeps the first submission that reached the highest score.
      if (take === "last" || score > cell.score) {
        cell.score = score;
        cell.at = submission.createdAt.getTime() - start;
      }
    }

    const rows = input.participants.map((participant) => {
      const cells = Object.fromEntries(byUser.get(participant.handle) ?? []);
      let total = 0;
      let lastAt = 0;

      for (const cell of Object.values(cells)) {
        total += cell.score;
        if (cell.score > 0 && cell.at !== null) {
          lastAt = Math.max(lastAt, cell.at);
        }
      }

      return { participant, total, tiebreak: lastAt, cells };
    });

    return {
      rows: assignRanks<OiCell>(rows),
      totalLabel: "总分",
      frozen: false,
    };
  },

  render: {
    Cell: OiCellView,
    Total: ({ row }: { row: StandingsRow<OiCell> }) => (
      <span className="text-fg font-mono font-semibold tabular-nums">
        {Math.round(row.total)}
      </span>
    ),
  },
};
