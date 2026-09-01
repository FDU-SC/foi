import type {
  AnyRuleset,
  ContestProblem,
  Participant,
  StandingsInput,
  SubmissionRecord,
} from "@/lib/standings/types";

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
): ContestProblem {
  return { slug, label, title: slug, points: null, maxScore, config: null };
}

let counter = 0;

export function submission(options: {
  uid: number;
  problemSlug: string;
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
    problemSlug: options.problemSlug,
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
  problemSlug: string,
  minutes: number,
): SubmissionRecord {
  return submission({ uid, problemSlug, minutes, score: 100 });
}

export function fail(
  uid: number,
  problemSlug: string,
  minutes: number,
  score = 0,
): SubmissionRecord {
  return submission({ uid, problemSlug, minutes, score });
}

export function unjudged(
  uid: number,
  problemSlug: string,
  minutes: number,
  state: Exclude<SubmissionRecord["state"], "completed"> = "pending",
): SubmissionRecord {
  return submission({ uid, problemSlug, minutes, score: 0, state });
}

export function input(options: {
  submissions: SubmissionRecord[];
  participants: Participant[];
  problems: ContestProblem[];
  config?: unknown;
  freezeAt?: Date | null;
  endsAt?: Date;
}): StandingsInput {
  return {
    config: options.config,
    contest: {
      slug: "test",
      startsAt: START,
      endsAt: options.endsAt ?? END,
    },
    problems: options.problems,
    participants: options.participants,
    submissions: options.submissions,
  };
}

/**
 * A contest may keep collecting after `endsAt` — that is what `afterEnd`
 * declares — and `compute.ts` hands a ruleset every submission attributed to
 * the round, late ones included. Scoring the window is therefore the ruleset's
 * job, done by running its submissions through `submissionsInWindow`.
 *
 * That makes the platform's promise only as good as each ruleset honouring it,
 * which is why both the kernel and each deployment assert it rather than
 * trusting that whoever writes the next ruleset remembers.
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
