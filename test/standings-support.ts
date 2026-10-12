import type {
  AnyRuleset,
  ContestProblem,
  ContestWindow,
  Participant,
  StandingsInput,
  SubmissionRecord,
} from "@/lib/standings/types";

/**
 * The contest every helper here attributes to unless told otherwise. Keys are
 * opaque to rulesets, so within it a problem's key is simply its slug.
 */
export const CONTEST = "test";

export const START = new Date("2026-01-15T13:00:00+08:00");
export const END = new Date("2026-01-15T18:00:00+08:00");

export function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

export function participants(...uids: number[]): Participant[] {
  return uids.map((uid) => ({ uid, nickname: `user-${uid}` }));
}

export function problem(
  slug: string,
  label: string,
  maxScore = 100,
  contestSlug = CONTEST,
): ContestProblem {
  return { key: slug, contestSlug, slug, label, title: slug, points: null, maxScore, config: null };
}

let counter = 0;

export function submission(options: {
  uid: number;
  problemKey: string;
  contestSlug?: string;
  minutes: number;
  score: number;
  maxScore?: number;
  accepted?: boolean;
  state?: SubmissionRecord["state"];
}): SubmissionRecord {
  const maxScore = options.maxScore ?? 100;
  const state = options.state ?? "completed";
  const accepted = options.accepted ?? options.score >= maxScore;
  const outcome = accepted ? "accepted" : "wrong_answer";
  return {
    id: `sub_${(counter += 1)}`,
    uid: options.uid,
    contestSlug: options.contestSlug ?? CONTEST,
    problemKey: options.problemKey,
    state,
    result:
      state === "completed"
        ? { status: outcome, score: options.score, maxScore, accepted }
        : null,
    createdAt: at(options.minutes),
  };
}

export function solve(
  uid: number,
  problemKey: string,
  minutes: number,
): SubmissionRecord {
  return submission({ uid, problemKey, minutes, score: 100 });
}

export function fail(
  uid: number,
  problemKey: string,
  minutes: number,
  score = 0,
): SubmissionRecord {
  return submission({ uid, problemKey, minutes, score });
}

export function unjudged(
  uid: number,
  problemKey: string,
  minutes: number,
  state: Exclude<SubmissionRecord["state"], "completed"> = "pending",
): SubmissionRecord {
  return submission({ uid, problemKey, minutes, score: 0, state });
}

export function input(options: {
  submissions: SubmissionRecord[];
  participants: Participant[];
  problems: ContestProblem[];
  config?: unknown;
  freezeAt?: Date | null;
  endsAt?: Date;

  /** Replaces the single default contest. */
  contests?: ContestWindow[];
}): StandingsInput {
  return {
    config: options.config,
    contests: options.contests ?? [
      { slug: CONTEST, startsAt: START, endsAt: options.endsAt ?? END },
    ],
    problems: options.problems,
    participants: options.participants,
    submissions: options.submissions,
  };
}

/**
 * `compute.ts` passes all contest submissions, including those accepted after
 * `endsAt`. Rulesets must filter with `submissionsInWindow`; kernel and deployment
 * tests both verify that late practice submissions do not affect rankings.
 */
export function ignoresLateSubmissions(ruleset: AnyRuleset): {
  onTime: unknown;
  withLate: unknown;
} {
  const base = {
    participants: participants(1, 2),
    problems: [problem("a", "A")],
  };

  /** Well past `END`, which sits five hours after `START`. */
  const LATE_MINUTES = 999;

  return {
    onTime: ruleset.compute(input({ ...base, submissions: [solve(1, "a", 10)] }))
      .rows,
    withLate: ruleset.compute(
      input({
        ...base,
        submissions: [solve(1, "a", 10), solve(2, "a", LATE_MINUTES)],
      }),
    ).rows,
  };
}
