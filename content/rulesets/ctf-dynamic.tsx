import { z } from "zod";
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
  initial: z.number().positive().default(500),
  minimum: z.number().nonnegative().default(100),
  decay: z.number().positive().default(20),
  bloodBonus: z.array(z.number()).default([0.1, 0.05, 0.02]),
});

export interface CtfCell {
  score: number;
  solvedAt: number | null;
  blood: number | null;
  attempts: number;
  pending: number;
}

const BLOOD_LABEL = ["一血", "二血", "三血"];

export function CtfCellView({ cell }: { cell: CtfCell | undefined }) {
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
          <span className="text-info">?</span>
        ) : null}
      </span>
    );
  }

  const bloodIndex = cell.blood !== null ? cell.blood - 1 : -1;
  const isBlood = bloodIndex >= 0 && bloodIndex < BLOOD_LABEL.length;

  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span
        className={`font-mono text-xs font-medium tabular-nums ${
          isBlood ? "text-warn" : "text-ok"
        }`}
      >
        {Math.round(cell.score)}
      </span>
      {isBlood ? (
        <span className="text-warn text-[10px]">{BLOOD_LABEL[bloodIndex]}</span>
      ) : null}
    </span>
  );
}

export function CtfTotalView({ row }: { row: StandingsRow<CtfCell> }) {
  return (
    <span className="text-fg font-mono font-semibold tabular-nums">
      {Math.round(row.total)}
    </span>
  );
}

import { ProblemGridBoard } from "@/content/_shared/leaderboards/problem-grid";

export const renderers = { Cell: CtfCellView, Total: CtfTotalView, Board: ProblemGridBoard };

export const ruleset: Ruleset<CtfCell> = {
  id: "ctf-dynamic",
  name: "CTF 动态分值",
  description: "题目分值随解出人数衰减，前三名解出者获得一/二/三血加成。",

  compute(input: StandingsInput) {
    const config = configSchema.parse(input.config ?? {});
    const start = input.contest.startsAt.getTime();

    const cellsByUser = new Map<number, Record<string, CtfCell>>();
    for (const participant of input.participants) {
      cellsByUser.set(participant.uid, {});
    }

    const solves = new Map<string, { uid: number; at: number }[]>();
    const attempts = new Map<string, number>();
    const pendingCounts = new Map<string, number>();
    const solvedKeys = new Set<string>();

    for (const submission of submissionsInWindow(input)) {
      if (!cellsByUser.has(submission.uid)) continue;

      const key = `${submission.uid}:${submission.problemSlug}`;
      if (solvedKeys.has(key)) continue;

      if (!hasResult(submission)) {
        pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + 1);
        continue;
      }

      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      if (!isAccepted(submission)) continue;

      solvedKeys.add(key);
      const list = solves.get(submission.problemSlug) ?? [];
      list.push({
        uid: submission.uid,
        at: submission.createdAt.getTime() - start,
      });
      solves.set(submission.problemSlug, list);
    }

    for (const problem of input.problems) {
      const list = (solves.get(problem.slug) ?? []).sort((a, b) => a.at - b.at);
      const value = decayedValue(config, list.length);

      list.forEach((solve, index) => {
        const cells = cellsByUser.get(solve.uid);
        if (!cells) return;
        const bonus = config.bloodBonus[index] ?? 0;
        const key = `${solve.uid}:${problem.slug}`;
        cells[problem.slug] = {
          score: value * (1 + bonus),
          solvedAt: solve.at,
          blood: index < config.bloodBonus.length ? index + 1 : null,
          attempts: attempts.get(key) ?? 1,
          pending: pendingCounts.get(key) ?? 0,
        };
      });
    }

    for (const [key, count] of attempts) {
      const [uidStr, slug] = splitKey(key);
      const cells = cellsByUser.get(Number(uidStr));
      if (!cells || cells[slug]) continue;
      cells[slug] = {
        score: 0,
        solvedAt: null,
        blood: null,
        attempts: count,
        pending: pendingCounts.get(key) ?? 0,
      };
    }

    for (const [key, count] of pendingCounts) {
      const [uidStr, slug] = splitKey(key);
      const cells = cellsByUser.get(Number(uidStr));
      if (!cells || cells[slug]) continue;
      cells[slug] = {
        score: 0,
        solvedAt: null,
        blood: null,
        attempts: 0,
        pending: count,
      };
    }

    const rows = input.participants.map((participant) => {
      const cells = cellsByUser.get(participant.uid) ?? {};
      let total = 0;
      let lastSolve = 0;
      for (const cell of Object.values(cells)) {
        total += cell.score;
        if (cell.solvedAt !== null) lastSolve = Math.max(lastSolve, cell.solvedAt);
      }
      return { participant, total, tiebreak: lastSolve, cells };
    });

    return {
      rows: assignRanks<CtfCell>(rows),
      totalLabel: "总分",
    };
  },
};

function decayedValue(
  config: z.infer<typeof configSchema>,
  solves: number,
): number {
  if (solves <= 1) return config.initial;
  const { initial, minimum, decay } = config;
  const value =
    ((minimum - initial) / (decay * decay)) * (solves - 1) ** 2 + initial;
  return Math.max(minimum, Math.ceil(value));
}

function splitKey(key: string): [string, string] {
  const index = key.indexOf(":");
  return [key.slice(0, index), key.slice(index + 1)];
}
