import type { ComponentType } from "react";
import type { SubmissionRecordState } from "@/lib/backend/types";

export interface ContestProblem {
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
}

export interface SubmissionRecord {
  id: string;
  uid: number;
  problemSlug: string;
  state: SubmissionRecordState;
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
  contest: ContestWindow;
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
}

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

export function submissionsInWindow(
  input: StandingsInput,
): SubmissionRecord[] {
  const { startsAt, endsAt } = input.contest;
  return input.submissions
    .filter(
      (submission) =>
        submission.state !== "disrupted" &&
        submission.createdAt >= startsAt &&
        submission.createdAt <= endsAt,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function scoredSubmissions(input: StandingsInput): SubmissionRecord[] {
  return submissionsInWindow(input).filter(
    (submission) => submission.state === "completed",
  );
}
