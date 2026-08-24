import type { ComponentType } from "react";
import type { SubmissionState, Verdict } from "@/lib/backend/types";

export interface ContestProblem {
  slug: string;
  label: string;
  title: string;
  /** Per-contest point override; falls back to the problem's own maxScore. */
  points: number | null;
  maxScore: number;
  config: unknown;
}

export interface Participant {
  /** Identifies the person everywhere: roster, credentials and submissions. */
  handle: string;
  displayName: string;
  unofficial: boolean;
}

/**
 * A submission as a ruleset sees it.
 *
 * `score`, `maxScore` and `accepted` are the kernel's resolved copies, not
 * fields dug out of `verdict` — see the note on that column in
 * `lib/db/schema.ts`. The verdict itself rides along for rulesets that
 * understand a particular problem's `detail`, which is the same bargain the
 * statement components get.
 */
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
  /** Raw contest config; each ruleset parses it with its own schema. */
  config: unknown;
  contest: ContestWindow;
  problems: ContestProblem[];
  participants: Participant[];
  submissions: SubmissionRecord[];
}

export interface StandingsRow<Cell> {
  rank: number;
  participant: Participant;
  /** Primary sort value, rendered in the total column. */
  total: number;
  /** Secondary sort value; lower wins. Penalty time, last-solve time, etc. */
  tiebreak: number;
  cells: Record<string, Cell | undefined>;
}

export interface Standings<Cell> {
  rows: StandingsRow<Cell>[];
  /** Column headers for `total` and `tiebreak`. */
  totalLabel: string;
  tiebreakLabel?: string;
  /** Set when results are hidden past the freeze time. */
  frozen: boolean;
}

/**
 * A scoring format.
 *
 * ACM, OI and CTF ship as templates, not as special cases — the kernel only
 * knows this interface. A new format is a new file in `content/rulesets/`, or
 * a `ruleset.tsx` beside one contest's own definition; see `content/index.ts`
 * for when each is the right choice.
 *
 * `computeStandings` is a pure function over every submission in the contest,
 * which keeps formats like CTF dynamic scoring (where one solve changes
 * everyone's score) expressible without incremental bookkeeping.
 */
export interface Ruleset<Cell = unknown> {
  id: string;
  name: string;
  description: string;
  /**
   * Whether this format implements the freeze window.
   *
   * Required rather than optional so that writing a new format forces an
   * answer. Freezing is not something the kernel can do on a format's behalf —
   * it has to decide what a submission made after the cutoff looks like, and
   * ACM's "pending" cell has no counterpart in a score-based board — so a
   * format that has not implemented it must say so. `lib/contests/registry.ts`
   * then refuses to load a contest that sets `freezeAt` against a format that
   * would quietly ignore it, which is how that mistake used to surface: not at
   * all, until the board failed to freeze during a live round.
   */
  supportsFreeze: boolean;
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

/** Assigns ranks, sharing a rank between rows that tie on both keys. */
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

/** Submissions within the scored window, oldest first. */
export function scoredSubmissions(input: StandingsInput): SubmissionRecord[] {
  const { startsAt, endsAt } = input.contest;
  return input.submissions
    .filter(
      (submission) =>
        submission.state === "completed" &&
        submission.createdAt >= startsAt &&
        submission.createdAt <= endsAt,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Whether a submission counts as solving its problem.
 *
 * A backend that said so decides it. Only when it stayed silent does the
 * kernel fall back to full marks, and that derivation lives here rather than
 * in a column so that improving it reaches every submission ever made — see
 * the note on `accepted` in `lib/db/schema.ts`. Problems where the two differ
 * are exactly the ones that declare it: a performance task can pass at two
 * times baseline and score full marks only at three.
 */
export function isAccepted(submission: SubmissionRecord): boolean {
  if (submission.state !== "completed") return false;
  if (submission.accepted !== null) return submission.accepted;
  if (submission.score === null || submission.maxScore === null) return false;
  return submission.score >= submission.maxScore;
}
