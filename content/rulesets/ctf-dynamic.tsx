import { z } from "zod";
import {
  assignRanks,
  isAccepted,
  scoredSubmissions,
  type Ruleset,
  type StandingsInput,
  type StandingsRow,
} from "@/lib/standings/types";

const configSchema = z.object({
  initial: z.number().positive().default(500),
  minimum: z.number().nonnegative().default(100),
  /** Larger values make a problem's value decay more slowly. */
  decay: z.number().positive().default(20),
  /** Multipliers applied to first, second and third blood. */
  bloodBonus: z.array(z.number()).default([0.1, 0.05, 0.02]),
});

export interface CtfCell {
  score: number;
  solvedAt: number | null;
  /** 1-indexed order of solve, used for blood highlighting. */
  blood: number | null;
  attempts: number;
}

const BLOOD_LABEL = ["一血", "二血", "三血"];

function CtfCellView({ cell }: { cell: CtfCell | undefined }) {
  if (!cell || cell.attempts === 0) {
    return <span className="text-fg-subtle">·</span>;
  }
  if (cell.solvedAt === null) {
    return (
      <span className="text-err font-mono text-xs tabular-nums">
        −{cell.attempts}
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

/**
 * CTF dynamic scoring: a problem is worth less the more teams solve it, so
 * every solve changes everyone's total. Values are computed in two passes —
 * count solves per problem, then award points — which is why the ruleset
 * interface takes all submissions at once rather than one at a time.
 *
 * The decay curve matches CTFd's, so values are comparable with what players
 * are used to.
 */
export const ruleset: Ruleset<CtfCell> = {
  id: "ctf-dynamic",
  name: "CTF 动态分值",
  description: "题目分值随解出人数衰减，前三名解出者获得一/二/三血加成。",
  // Dynamic scoring makes this awkward rather than merely unimplemented:
  // withholding one solve changes what every other team is worth, so a frozen
  // board would have to show scores that are wrong for everyone, not just
  // incomplete for one.
  supportsFreeze: false,

  computeStandings(input: StandingsInput) {
    const config = configSchema.parse(input.config ?? {});
    const start = input.contest.startsAt.getTime();
    const official = new Set(
      input.participants
        .filter((participant) => !participant.unofficial)
        .map((participant) => participant.handle),
    );

    const submissions = scoredSubmissions(input);

    // Pass 1: earliest accepted submission per (user, problem).
    const solves = new Map<string, { handle: string; at: number }[]>();
    const attempts = new Map<string, number>();
    const solvedKeys = new Set<string>();

    for (const submission of submissions) {
      const key = `${submission.handle}:${submission.problemSlug}`;
      if (solvedKeys.has(key)) continue;

      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      if (!isAccepted(submission)) continue;

      solvedKeys.add(key);
      const list = solves.get(submission.problemSlug) ?? [];
      list.push({
        handle: submission.handle,
        at: submission.createdAt.getTime() - start,
      });
      solves.set(submission.problemSlug, list);
    }

    // Pass 2: value each problem from its official solve count, then award.
    const cellsByUser = new Map<string, Record<string, CtfCell>>();
    for (const participant of input.participants) {
      cellsByUser.set(participant.handle, {});
    }

    for (const problem of input.problems) {
      const list = (solves.get(problem.slug) ?? []).sort((a, b) => a.at - b.at);
      const officialSolves = list.filter((solve) =>
        official.has(solve.handle),
      ).length;
      const value = decayedValue(config, officialSolves);

      list.forEach((solve, index) => {
        const cells = cellsByUser.get(solve.handle);
        if (!cells) return;
        const bonus = config.bloodBonus[index] ?? 0;
        cells[problem.slug] = {
          score: value * (1 + bonus),
          solvedAt: solve.at,
          blood: index < config.bloodBonus.length ? index + 1 : null,
          attempts: attempts.get(`${solve.handle}:${problem.slug}`) ?? 1,
        };
      });
    }

    // Unsolved problems still need a cell so failed attempts are visible.
    for (const [key, count] of attempts) {
      const [handle, slug] = splitKey(key);
      const cells = cellsByUser.get(handle);
      if (!cells || cells[slug]) continue;
      cells[slug] = { score: 0, solvedAt: null, blood: null, attempts: count };
    }

    const rows = input.participants.map((participant) => {
      const cells = cellsByUser.get(participant.handle) ?? {};
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
      tiebreakLabel: "末次解题",
      frozen: false,
    };
  },

  render: {
    Cell: CtfCellView,
    Total: ({ row }: { row: StandingsRow<CtfCell> }) => (
      <span className="text-fg font-mono font-semibold tabular-nums">
        {Math.round(row.total)}
      </span>
    ),
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
