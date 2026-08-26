import { asc, eq } from "drizzle-orm";
import { contestBySlug } from "@/lib/contests/registry";
import {
  resolveContestProblems,
  resolveParticipants,
} from "@/lib/contests/resolve";
import { contestPhase, type ContestConfig } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/viewer";
import { cachedStandings, standingsKey } from "./cache";
import { rulesetFor } from "./registry";
import type {
  AnyRuleset,
  ContestProblem,
  Participant,
  Standings,
  SubmissionRecord,
} from "./types";

export interface ContestStandings {
  contest: ContestConfig;
  problems: ContestProblem[];
  ruleset: AnyRuleset;
  standings: Standings<unknown>;
  /**
   * True when the contest is inside its freeze window but this board was
   * computed without it. Nothing depends on it but the label — a board that
   * silently differs from the one everyone else is looking at is a good way to
   * misread a contest.
   */
  freezeBypassed: boolean;
}

/**
 * The contest, its problem set and its roster all come from the registry; the
 * database is queried only for the submissions, so the standings reflect the
 * repository rather than whatever a past administrator clicked.
 */
async function loadAndCompute(
  slug: string,
  ignoreFreeze: boolean,
): Promise<ContestStandings | null> {
  const contest = contestBySlug(slug);
  if (!contest) return null;

  // The registry refused to load a contest without a resolvable format, so
  // this only fires if the two disagree.
  const ruleset = rulesetFor(contest.slug, contest.ruleset.id);
  if (!ruleset) {
    throw new Error(`比赛 "${contest.slug}" 没有可用的赛制`);
  }

  const problemRows = resolveContestProblems(contest);

  const submissionRows = await db
    .select({
      id: submissions.id,
      handle: submissions.handle,
      problemSlug: submissions.problemSlug,
      state: submissions.state,
      verdict: submissions.verdict,
      score: submissions.score,
      maxScore: submissions.maxScore,
      accepted: submissions.accepted,
      createdAt: submissions.createdAt,
      displayName: accounts.displayName,
    })
    .from(submissions)
    .innerJoin(accounts, eq(accounts.handle, submissions.handle))
    .where(eq(submissions.contestSlug, contest.slug))
    .orderBy(asc(submissions.createdAt));

  const declared = await resolveParticipants(contest);

  // A contest with `participants: { mode: "open" }` names no field, so anyone
  // who submitted counts. This keeps casual contests usable with no entry step
  // at all.
  const participants: Participant[] =
    declared === null
      ? deriveParticipants(submissionRows)
      : declared.map((entrant) => ({
          handle: entrant.handle,
          displayName: entrant.displayName,
        }));

  // Withholding the freeze is expressed by handing the ruleset a contest that
  // has none. No format has to know this option exists, and none can get it
  // half right — the freeze is entirely a function of `freezeAt`.
  const freezeAt = ignoreFreeze ? null : (contest.freezeAt ?? null);

  const input = {
    config: contest.ruleset.config,
    contest: {
      slug: contest.slug,
      startsAt: contest.startsAt,
      endsAt: contest.endsAt,
      freezeAt,
    },
    problems: problemRows satisfies ContestProblem[],
    participants,
    submissions: submissionRows satisfies SubmissionRecord[],
  };

  // The window is the kernel's, so this asks the kernel for it rather than
  // spelling the comparison out inline to match what a shipped ruleset does —
  // that has the dependency backwards. `[freezeAt, endsAt]` is defined on
  // `ContestPhase`, the loader refuses a `freezeAt` outside `[startsAt,
  // endsAt)`, and a format applying a different interval is the thing that is
  // wrong.
  const wouldFreeze = contestPhase(contest) === "frozen";

  return {
    contest,
    problems: problemRows,
    ruleset,
    standings: ruleset.computeStandings(input),
    freezeBypassed: ignoreFreeze && wouldFreeze,
  };
}

/**
 * An open contest has no declared entry list, so whoever submitted competes.
 * Their display name rode along on the join above, which is what keeps this a
 * pure function of the rows it was handed.
 */
function deriveParticipants(
  rows: { handle: string; displayName: string }[],
): Participant[] {
  const seen = new Map<string, Participant>();
  for (const row of rows) {
    if (seen.has(row.handle)) continue;
    seen.set(row.handle, {
      handle: row.handle,
      displayName: row.displayName,
    });
  }
  return [...seen.values()];
}

/**
 * The board this viewer should see.
 *
 * Reading through a freeze is its own capability, `standings.viewFrozen`. In
 * practice `submission.readAny` already implies it — somebody who can open
 * every submission can add them up — but the question an operator asks is
 * "who sees through the freeze", and an answer they have to derive from
 * another capability is one they will get wrong under pressure.
 *
 * Both forms are cached, under different keys. Serving one where the other was
 * asked for would either leak a live board mid-freeze or hide results from the
 * person running the contest.
 */
export function standingsFor(
  slug: string,
  viewer: Viewer,
): Promise<ContestStandings | null> {
  const ignoreFreeze = viewer.can("standings.viewFrozen");
  return cachedStandings(
    standingsKey(slug, ignoreFreeze ? "unfrozen" : "public"),
    () => loadAndCompute(slug, ignoreFreeze),
  );
}
