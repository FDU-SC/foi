import { z } from "zod";
import {
  assignRanks,
  scoredSubmissions,
  type Ruleset,
  type StandingsInput,
  type StandingsRow,
} from "@/lib/standings/types";

interface OiResult { score: number; maxScore: number }

const configSchema = z.object({
  take: z.enum(["best", "last"]).default("best"),
});

export interface OiCell {
  score: number;
  maxScore: number;
  attempts: number;
  at: number | null;
}

export function OiCellView({ cell }: { cell: OiCell | undefined }) {
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

export function OiTotalView({ row }: { row: StandingsRow<OiCell> }) {
  return (
    <span className="text-fg font-mono font-semibold tabular-nums">
      {Math.round(row.total)}
    </span>
  );
}

export const ruleset: Ruleset<OiCell> = {
  id: "oi",
  name: "OI",
  description: "每题取最高分（或最后一次提交），按总分排名。",

  compute(input: StandingsInput) {
    const { take } = configSchema.parse(input.config ?? {});
    const start = input.contest.startsAt.getTime();

    const worth = new Map(
      input.problems.map((problem) => [
        problem.slug,
        problem.points ?? problem.maxScore,
      ]),
    );

    const byUser = new Map<number, Map<string, OiCell>>();
    for (const participant of input.participants) {
      byUser.set(participant.uid, new Map());
    }

    for (const submission of scoredSubmissions(input)) {
      const cells = byUser.get(submission.uid);
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

      const r = submission.result as OiResult | null;
      const raw = r?.score ?? 0;
      const outOf = r?.maxScore;
      const score =
        outOf && outOf > 0 && outOf !== maxScore
          ? (raw / outOf) * maxScore
          : raw;

      if (take === "last" || score > cell.score) {
        cell.score = score;
        cell.at = submission.createdAt.getTime() - start;
      }
    }

    const rows = input.participants.map((participant) => {
      const cells = Object.fromEntries(byUser.get(participant.uid) ?? []);
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
    };
  },
};
