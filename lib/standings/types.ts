import type { ComponentType } from "react";
import type { SubmissionState, Verdict } from "@/lib/backend/types";

export interface ContestProblem {
  slug: string;
  label: string;
  title: string;

  points: number | null;
  maxScore: number;
  config: unknown;
}

export interface Participant {

  handle: string;
  displayName: string;
}

export interface SubmissionRecord {
  id: string;
  handle: string;
  problemSlug: string;
  state: SubmissionState;
  verdict: Verdict | null;
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;
  createdAt: Date;
}

export interface ContestWindow {
  slug: string;
  startsAt: Date;
  endsAt: Date;
  freezeAt: Date | null;
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

export interface Standings<Cell> {
  rows: StandingsRow<Cell>[];

  totalLabel: string;

  frozen: boolean;
}

export interface Ruleset<Cell = unknown> {
  id: string;
  name: string;
  description: string;

  supportsFreeze?: boolean;
  computeStandings(input: StandingsInput): Standings<Cell>;
  render?: {
    Cell?: ComponentType<{ cell: Cell | undefined; problem: ContestProblem }>;
    Total?: ComponentType<{ row: StandingsRow<Cell> }>;
  };
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
   The registry is heterogeneous by design: each ruleset picks its own Cell
   type, and Cell appears in both covariant (Standings) and contravariant
   (render.Cell props) positions, so no single sound supertype exists. */
export type AnyRuleset = Ruleset<any>;

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

export function isAccepted(submission: SubmissionRecord): boolean {
  if (submission.state !== "completed") return false;
  if (submission.accepted !== null) return submission.accepted;
  if (submission.score === null || submission.maxScore === null) return false;
  return submission.score >= submission.maxScore;
}
