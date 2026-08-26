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
  /**
   * Header for the total column.
   *
   * There is no counterpart for `tiebreak`, because there is no column for it:
   * a format that wants its tiebreak on screen renders it inside `render.Total`,
   * under the total it belongs to.
   */
  totalLabel: string;
  /** Set when results are hidden past the freeze time. */
  frozen: boolean;
}

/**
 * A scoring format.
 *
 * Every format ships as a template, not as a special case — the kernel only
 * knows this interface, and has no built-in notion of penalty time, subtask
 * totals or dynamic scoring. A new format is a new file in `content/rulesets/`,
 * or a `ruleset.tsx` beside one contest's own definition; see
 * `content-ruleset-modules.ts` for when each is the right choice.
 *
 * `computeStandings` is a pure function over every submission in the contest,
 * which keeps formats where one solve changes everyone's score expressible
 * without incremental bookkeeping.
 */
export interface Ruleset<Cell = unknown> {
  id: string;
  name: string;
  description: string;
  /**
   * Whether this format implements the freeze window. Omitted means it does
   * not.
   *
   * Freezing is not something the kernel can do on a format's behalf — it has
   * to decide what a submission made after the cutoff looks like, and a
   * "pending" cell on a solve-count board has no counterpart on a score-based
   * one — so `lib/contests/registry.ts` refuses to load a contest that sets
   * `freezeAt` against a format that would quietly ignore it. Without that
   * refusal the mistake surfaces only when a board fails to freeze during a
   * live round.
   *
   * Optional rather than required, because freezing the scoreboard for the
   * last hour is one competition tradition's ritual and a format that has never
   * heard of it should not have to open by declining to implement it. The check
   * is not softened along with it: a contest naming `freezeAt` against a format
   * that says nothing still fails to load.
   */
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

/**
 * Everything sent during the contest window, oldest first, whatever state it
 * is in.
 *
 * `disrupted` is the one state dropped, and it is dropped here rather than at
 * each caller because it is not a submission anybody is waiting on: the
 * judging produced no conclusion, none is coming, and it is explicitly not
 * charged to the person who submitted — see the note on the state in
 * `lib/backend/types.ts`. A format that showed it would be showing a cell that
 * never resolves.
 */
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

/**
 * The subset of those that have a verdict.
 *
 * What makes this the *scored* set is the state filter: a format asking for
 * these is about to read `score` or `isAccepted`, and neither means anything
 * before a backend has answered. A format that also has something to say about
 * the ones still in the queue — drawing them as pending, say — asks
 * `submissionsInWindow` and sorts them out itself.
 */
export function scoredSubmissions(input: StandingsInput): SubmissionRecord[] {
  return submissionsInWindow(input).filter(
    (submission) => submission.state === "completed",
  );
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
