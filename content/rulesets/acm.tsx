import { z } from "zod";
import { cn, formatDuration } from "@/lib/utils";
import {
  assignRanks,
  elapsed,
  hasResult,
  submissionsInWindow,
  type Ruleset,
  type StandingsInput,
  type StandingsRow,
  type SubmissionRecord,
} from "@/lib/standings/types";

function isAccepted(submission: SubmissionRecord): boolean {
  const result = submission.result as { accepted?: boolean } | null;
  return result?.accepted === true;
}

const configSchema = z.object({
  penaltyMinutes: z.number().nonnegative().default(20),
});

export interface AcmCell {
  attempts: number;
  solvedAt: number | null;
  pending: number;

  /** Solved no later than anyone else on this board solved the problem. */
  firstSolve: boolean;
}

const TILE =
  "flex h-[38px] w-full flex-col items-center justify-center leading-tight tabular-nums";

/**
 * ICPC scoreboard notation: `+` solved at the first try, `+N` after N wrong
 * ones, `−N` for N wrong tries, `?` for tries still unrevealed.
 */
export function AcmCellView({ cell }: { cell: AcmCell | undefined }) {
  if (!cell || (cell.attempts === 0 && cell.pending === 0)) return null;

  if (cell.solvedAt !== null) {
    const wrong = cell.attempts - 1;
    return (
      <span
        title={cell.firstSolve ? "首杀" : undefined}
        className={cn(TILE, cell.firstSolve ? "bg-ok-strong text-white" : "bg-ok-subtle text-ok")}
      >
        <span className="text-sm font-bold">+{wrong > 0 ? wrong : ""}</span>
        <span className={cn("text-[11px]", cell.firstSolve ? "text-white/85" : "text-fg-muted")}>
          {formatDuration(cell.solvedAt * 60_000)}
        </span>
      </span>
    );
  }

  if (cell.pending > 0) {
    return (
      <span className={cn(TILE, "bg-info-subtle text-info")}>
        <span className="text-sm font-bold">?</span>
        <span className="text-[11px]">{cell.attempts + cell.pending} 次</span>
      </span>
    );
  }

  return (
    <span className={cn(TILE, "bg-err-subtle text-err")}>
      <span className="text-sm font-bold">−{cell.attempts}</span>
    </span>
  );
}

export function AcmTotalView({ row }: { row: StandingsRow<AcmCell> }) {
  return (
    <span className="inline-flex flex-col items-center leading-tight tabular-nums">
      <span className="text-fg font-semibold">{row.total}</span>
      <span className="text-fg-subtle text-[10px]">{row.tiebreak}</span>
    </span>
  );
}

import { ProblemGridBoard } from "@/content/_shared/leaderboards/problem-grid";

export const renderers = { Cell: AcmCellView, Total: AcmTotalView, Board: ProblemGridBoard };

export const ruleset: Ruleset<AcmCell> = {
  id: "acm",
  name: "ACM / ICPC",
  description: "按通过题数排名，同数比罚时。",

  compute(input: StandingsInput) {
    const { penaltyMinutes } = configSchema.parse(input.config ?? {});
    const byUser = new Map<number, Map<string, AcmCell>>();
    for (const participant of input.participants) {
      byUser.set(participant.uid, new Map());
    }

    // Compared to the millisecond, so a tie in the displayed minute is not one.
    const solvedMs = new Map<AcmCell, number>();
    const firstMs = new Map<string, number>();

    for (const submission of submissionsInWindow(input)) {
      const cells = byUser.get(submission.uid);
      if (!cells) continue;

      const cell = cells.get(submission.problemKey) ?? {
        attempts: 0,
        solvedAt: null,
        pending: 0,
        firstSolve: false,
      };
      cells.set(submission.problemKey, cell);

      if (cell.solvedAt !== null) continue;

      if (!hasResult(submission)) {
        cell.pending += 1;
        continue;
      }

      cell.attempts += 1;
      if (isAccepted(submission)) {
        const ms = elapsed(input, submission);
        cell.solvedAt = Math.floor(ms / 60_000);
        solvedMs.set(cell, ms);
        const first = firstMs.get(submission.problemKey);
        if (first === undefined || ms < first) firstMs.set(submission.problemKey, ms);
      }
    }

    for (const cells of byUser.values()) {
      for (const [key, cell] of cells) {
        cell.firstSolve = solvedMs.has(cell) && solvedMs.get(cell) === firstMs.get(key);
      }
    }

    const rows = input.participants.map((participant) => {
      const cells = Object.fromEntries(byUser.get(participant.uid) ?? []);
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
    };
  },
};
