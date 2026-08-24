import type {
  ContestProblem,
  Participant,
  StandingsInput,
  SubmissionRecord,
} from "./types";

/**
 * Fixture builders for the ruleset suites.
 *
 * Scoring is where a bug is least likely to be noticed and least possible to
 * undo — a wrong penalty or a missed freeze only surfaces as a final ranking
 * somebody disputes. These builders keep each case down to the two or three
 * facts it is actually about, so the cases stay readable enough to audit.
 */

/** Contest start, with an explicit offset for the same reason contests need one. */
export const START = new Date("2026-01-15T13:00:00+08:00");
export const END = new Date("2026-01-15T18:00:00+08:00");

/** A moment `minutes` into the contest. */
export function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

export function participants(...handles: string[]): Participant[] {
  return handles.map((handle) => ({
    handle,
    displayName: handle.toUpperCase(),
    unofficial: false,
  }));
}

export function problem(
  slug: string,
  label: string,
  maxScore = 100,
): ContestProblem {
  return { slug, label, title: slug, points: null, maxScore, config: null };
}

let counter = 0;

/**
 * One submission. `score` is against `maxScore`, so `solve()` and `fail()`
 * below cover the two cases every ruleset keys off.
 */
export function submission(options: {
  handle: string;
  problemSlug: string;
  minutes: number;
  score: number;
  maxScore?: number;
  state?: SubmissionRecord["state"];
}): SubmissionRecord {
  const maxScore = options.maxScore ?? 100;
  const state = options.state ?? "completed";
  return {
    id: `sub_${(counter += 1)}`,
    handle: options.handle,
    problemSlug: options.problemSlug,
    state,
    verdict:
      state === "completed"
        ? {
            status: options.score >= maxScore ? "accepted" : "wrong_answer",
            score: options.score,
            maxScore,
          }
        : null,
    score: options.score,
    createdAt: at(options.minutes),
  };
}

export function solve(
  handle: string,
  problemSlug: string,
  minutes: number,
): SubmissionRecord {
  return submission({ handle, problemSlug, minutes, score: 100 });
}

export function fail(
  handle: string,
  problemSlug: string,
  minutes: number,
  score = 0,
): SubmissionRecord {
  return submission({ handle, problemSlug, minutes, score });
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
      freezeAt: options.freezeAt ?? null,
    },
    problems: options.problems,
    participants: options.participants,
    submissions: options.submissions,
  };
}
