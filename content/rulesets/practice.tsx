import { AnimatedNumber } from "@/components/ui/animated-number";
import {
  assignRanks,
  hasResult,
  submissionsInWindow,
  type Ruleset,
  type StandingsInput,
  type StandingsRow,
  type SubmissionRecord,
} from "@/lib/standings/types";
import { summaryBoard } from "@/content/_shared/leaderboards/summary";
import { isAcceptedResult } from "@/content/_shared/verdicts";

export interface PracticeCell {
  /** The best score so far, scaled to what the contest makes the problem worth. */
  score: number;
  maxScore: number;
  attempts: number;
  pending: number;
  solved: boolean;

  /** The earliest accepted submission to this problem on the board is this one's. */
  firstBlood: boolean;

  /** When the best score was first reached, in epoch milliseconds. */
  at: number | null;
}

/** The submission's score out of `worth`, or 0 when the result carries none. */
function scaled(submission: SubmissionRecord, worth: number): number {
  const result = submission.result as { score?: unknown; maxScore?: unknown } | null;
  if (typeof result?.score !== "number") return 0;
  const outOf = typeof result.maxScore === "number" && result.maxScore > 0 ? result.maxScore : worth;
  return Math.max(0, (result.score / outOf) * worth);
}

export function PracticeCellView({ cell }: { cell: PracticeCell | undefined }) {
  if (!cell || (cell.attempts === 0 && cell.pending === 0)) {
    return <span className="text-fg-subtle">·</span>;
  }
  if (cell.attempts === 0) {
    return <span className="text-info font-mono text-xs tabular-nums">?</span>;
  }

  const tone = cell.solved ? "text-ok" : cell.score > 0 ? "text-partial" : "text-err";
  return (
    <span className={`font-mono text-xs font-medium tabular-nums ${tone}`}>
      {Math.round(cell.score)}
    </span>
  );
}

export function PracticeTotalView({ row }: { row: StandingsRow<PracticeCell> }) {
  return (
    <AnimatedNumber
      value={Math.round(row.total)}
      className="text-fg font-mono font-semibold tabular-nums"
    />
  );
}

function cellsOf(row: StandingsRow<PracticeCell>): PracticeCell[] {
  return Object.values(row.cells).flatMap((cell) => cell ?? []);
}

export const renderers = {
  Cell: PracticeCellView,
  Total: PracticeTotalView,
  Board: summaryBoard<PracticeCell>([
    { label: "解题数", value: (row) => cellsOf(row).filter((cell) => cell.solved).length },
    { label: "提交次数", value: (row) => cellsOf(row).reduce((sum, cell) => sum + cell.attempts, 0) },
    { label: "首杀", value: (row) => cellsOf(row).filter((cell) => cell.firstBlood).length },
  ]),
};

export const ruleset: Ruleset<PracticeCell> = {
  id: "practice",
  name: "练习",
  description: "每题取最高分，按总分排名。",

  compute(input: StandingsInput) {
    const worth = new Map(
      input.problems.map((problem) => [problem.key, problem.points ?? problem.maxScore]),
    );

    const byUser = new Map<number, Map<string, PracticeCell>>();
    for (const participant of input.participants) {
      byUser.set(participant.uid, new Map());
    }

    const bloodied = new Set<string>();
    for (const submission of submissionsInWindow(input)) {
      const cells = byUser.get(submission.uid);
      if (!cells) continue;

      const maxScore = worth.get(submission.problemKey) ?? 0;
      const cell = cells.get(submission.problemKey) ?? {
        score: 0,
        maxScore,
        attempts: 0,
        pending: 0,
        solved: false,
        firstBlood: false,
        at: null,
      };
      cells.set(submission.problemKey, cell);

      if (!hasResult(submission)) {
        cell.pending += 1;
        continue;
      }

      cell.attempts += 1;
      const score = scaled(submission, maxScore);
      if (score > cell.score) {
        cell.score = score;
        cell.at = submission.createdAt.getTime();
      }
      if (isAcceptedResult(submission.result)) {
        cell.solved = true;
        if (!bloodied.has(submission.problemKey)) {
          bloodied.add(submission.problemKey);
          cell.firstBlood = true;
        }
      }
    }

    const rows = input.participants.map((participant) => {
      const cells = Object.fromEntries(byUser.get(participant.uid) ?? []);
      let total = 0;
      let reachedAt = 0;
      for (const cell of Object.values(cells)) {
        total += cell.score;
        if (cell.score > 0 && cell.at !== null) reachedAt = Math.max(reachedAt, cell.at);
      }
      return { participant, total, tiebreak: reachedAt, cells };
    });

    return {
      rows: assignRanks<PracticeCell>(rows),
      totalLabel: "总分",
    };
  },
};
