import type { ComponentType } from "react";
import type { SubmissionRecordState } from "@/lib/backend/types";

export interface ContestProblem {
  /**
   * What cells and submissions are keyed by. A board may span contests that
   * carry the same problem, so the key names the pair, never the slug alone.
   */
  key: string;
  contestSlug: string;
  slug: string;
  label: string;
  title: string;

  points: number | null;
  maxScore: number;
  config: unknown;
}

export interface Participant {

  uid: number;
  nickname: string;

  /** Optional so a ruleset's own fixtures need not know about accounts. */
  username?: string;
  avatarUpdatedAt?: Date | null;
}

export interface SubmissionRecord {
  id: string;
  uid: number;
  contestSlug: string;
  /** Matches the `key` of the problem it was made to. */
  problemKey: string;
  state: SubmissionRecordState;
  /** May be `null` even when state is "completed" (freeze-masked). */
  result: unknown;
  createdAt: Date;
}

export interface ContestWindow {
  slug: string;
  startsAt: Date;
  endsAt: Date;
}

export interface StandingsInput {

  config: unknown;

  /** Every contest the board spans. Each submission is scored in its own. */
  contests: ContestWindow[];
  problems: ContestProblem[];
  participants: Participant[];
  submissions: SubmissionRecord[];
}

export interface StandingsRow<Cell> {
  rank: number;
  participant: Participant;

  total: number;

  tiebreak: number;
  cells: Record<string, Cell | undefined>;
}

export interface ComputedStandings<Cell> {
  rows: StandingsRow<Cell>[];
  totalLabel: string;
}

export interface Ruleset<Cell = unknown> {
  id: string;
  name: string;
  description: string;

  compute(input: StandingsInput): ComputedStandings<Cell>;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
   The registry is heterogeneous by design: each ruleset picks its own Cell
   type, and callers don't need to know Cell at the registry level. */
export type AnyRuleset = Ruleset<any>;

export interface RulesetRenderers {
  Cell?: ComponentType<{ cell: unknown; problem: ContestProblem }>;
  Total?: ComponentType<{ row: StandingsRow<unknown> }>;
  /** Entire leaderboard view. Falls back to a plain ranked list in the platform. */
  Board?: ComponentType<BoardProps>;
}

export interface BoardProps {
  board: {
    standings: ComputedStandings<unknown>;
    renderers: RulesetRenderers;
  };
  problems: ContestProblem[];

  /** The viewer's uid, for a board that marks their own row. */
  highlight?: number | null;
}

/** Fixed comparator: total descending, tiebreak ascending. Not customizable by rulesets. */
export function assignRanks<Cell>(
  rows: Omit<StandingsRow<Cell>, "rank">[],
): StandingsRow<Cell>[] {
  const sorted = [...rows].sort(
    (a, b) => b.total - a.total || a.tiebreak - b.tiebreak,
  );

  let lastRank = 0;
  let lastTotal = Number.NaN;
  let lastTiebreak = Number.NaN;

  return sorted.map((row, index) => {
    const tied = row.total === lastTotal && row.tiebreak === lastTiebreak;
    if (!tied) {
      lastRank = index + 1;
      lastTotal = row.total;
      lastTiebreak = row.tiebreak;
    }
    return { ...row, rank: lastRank };
  });
}

function windowOf(
  input: StandingsInput,
  submission: SubmissionRecord,
): ContestWindow | undefined {
  return input.contests.find((contest) => contest.slug === submission.contestSlug);
}

/** Submissions inside their own contest's `startsAt`..`endsAt`, oldest first. */
export function submissionsInWindow(
  input: StandingsInput,
): SubmissionRecord[] {
  return input.submissions
    .filter((submission) => {
      const window = windowOf(input, submission);
      return (
        window !== undefined &&
        submission.state !== "disrupted" &&
        submission.createdAt >= window.startsAt &&
        submission.createdAt <= window.endsAt
      );
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Milliseconds from the start of the submission's own contest. */
export function elapsed(
  input: StandingsInput,
  submission: SubmissionRecord,
): number {
  const start = windowOf(input, submission)?.startsAt.getTime() ?? 0;
  return submission.createdAt.getTime() - start;
}

export function scoredSubmissions(input: StandingsInput): SubmissionRecord[] {
  return submissionsInWindow(input).filter(
    (submission) => submission.state === "completed" && submission.result != null,
  );
}

/** True when the submission has a usable result (completed with non-null result). */
export function hasResult(submission: SubmissionRecord): boolean {
  return submission.state === "completed" && submission.result != null;
}
