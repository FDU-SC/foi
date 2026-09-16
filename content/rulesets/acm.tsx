import { z } from "zod";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatDuration } from "@/lib/utils";
import {
  assignRanks,
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
}

export function AcmCellView({ cell }: { cell: AcmCell | undefined }) {
  if (!cell || (cell.attempts === 0 && cell.pending === 0)) {
    return <span className="text-fg-subtle">·</span>;
  }

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

export function AcmTotalView({ row }: { row: StandingsRow<AcmCell> }) {
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <AnimatedNumber
        value={row.total}
        className="text-fg font-mono font-semibold tabular-nums"
      />
      <AnimatedNumber
        value={row.tiebreak}
        className="text-fg-subtle font-mono text-[10px] tabular-nums"
      />
    </span>
  );
}

import { ProblemGridBoard } from "@/content/_shared/leaderboards/problem-grid";

export const renderers = { Cell: AcmCellView, Total: AcmTotalView, Board: ProblemGridBoard };

export const ruleset: Ruleset<AcmCell> = {
  id: "acm",
  name: "ACM / ICPC",
  description: "按通过题数排名，同数按罚时（解题时间 + 错误提交罚分）排序。",

  compute(input: StandingsInput) {
    const { penaltyMinutes } = configSchema.parse(input.config ?? {});
    const start = input.contest.startsAt.getTime();

    const byUser = new Map<number, Map<string, AcmCell>>();
    for (const participant of input.participants) {
      byUser.set(participant.uid, new Map());
    }

    for (const submission of submissionsInWindow(input)) {
      const cells = byUser.get(submission.uid);
      if (!cells) continue;

      const cell = cells.get(submission.problemSlug) ?? {
        attempts: 0,
        solvedAt: null,
        pending: 0,
      };
      cells.set(submission.problemSlug, cell);

      if (cell.solvedAt !== null) continue;

      if (!hasResult(submission)) {
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
