import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { resolveUser } from "@/lib/accounts/resolve";
import type { JobDetails, JobTicket, Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { runners, submissions } from "@/lib/db/schema";
import { isInlineBackend } from "@/lib/problems/types";
import { problemBySlug } from "@/lib/problems/registry";
import { invalidateStandings } from "@/lib/standings/cache";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";
import { verdictColumns } from "@/lib/submissions/verdict";

/**
 * The queue. Runners pull from it; the kernel never dispatches.
 *
 * The whole reliability story is the three numbers below, and there is
 * deliberately nothing else: no queue snapshots, no set differences, no health
 * layer. A job nobody claimed is a job nobody claimed, so redelivery needs no
 * protocol, and prefetching is something a runner does rather than something
 * the wire format has to express.
 */

/**
 * How long a holder may go quiet before the job is taken back.
 *
 * Not "how long may judging take". A runner evaluating a thirty-minute
 * performance problem heartbeats throughout and keeps its job; one that
 * segfaults two seconds in loses it after this. Uniform across every backend
 * and every problem, which is the property that made it placeable at all.
 */
export const HEARTBEAT_LAPSE_MS = 90_000;

/**
 * How many times one submission may be handed out before the kernel stops.
 *
 * The case this exists for is a submission that kills whatever picks it up. Not
 * hypothetical: a payload that trips a bug in the runner takes down every
 * runner in turn, and without a cap it does so forever, ejecting each one from
 * the pool for a heartbeat lapse on the way past.
 */
export const MAX_ATTEMPTS = 3;

/**
 * How long a job may sit unclaimed before the kernel gives up on it.
 *
 * The only guard against nobody running a runner for this backend at all: a
 * backend deleted from `content/backends.ts`, a deployment where somebody
 * forgot to start the runner, an outage that outlasts the round. Long, because
 * it must not fire during an ordinary backlog — six hours is longer than any
 * queue this deployment can produce and shorter than a competitor's patience.
 */
export const QUEUE_FUSE_MS = 6 * 60 * 60_000;

/**
 * How recently a runner must have asked for work to count as here.
 *
 * Not one of the three above, and deliberately placed after them: those decide
 * what happens to a row, this decides nothing at all. It is the window the
 * board and `/api/health` count `runners` over — the number that tells a
 * backlog apart from an outage — so nothing is written or refused on the back
 * of it. Both readers must keep taking it from here: two literals that can
 * disagree leave an operator unable to tell a stale board from a real
 * disagreement about what "out there" means.
 *
 * Several times the poll interval the protocol suggests, because a runner that
 * misses one poll to a network hiccup has not gone anywhere and a board that
 * flickers is one nobody reads. What it has to catch is a runner that has
 * stopped, and that shows up within a minute.
 */
export const RUNNER_ONLINE_MS = 60_000;

/**
 * A fresh holder token.
 *
 * 256 bits of randomness, stored and compared as-is. Not hashed, and the
 * difference from a callback token is worth being explicit about: that was a
 * bearer credential — holding it was the entire authority to write a verdict —
 * so a database leak had to not yield one. This authorises nothing. Every
 * request carries an HMAC over its body, and that is what says "this is the
 * traditional backend". The lease answers the narrower question of whether the
 * caller is the *current* holder of this row, which is a fact the row already
 * knows in plaintext.
 */
function mintLease(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Records that this runner is alive, whether or not there was work for it.
 *
 * On every ask rather than on every successful claim, because "is anybody
 * running a runner for this backend" and "does this backend have a queue" are
 * exactly the two questions an operator needs separated — a runner polling an
 * empty queue is the healthy case and has to be visible as such.
 *
 * One upsert per poll per runner, at a poll every second or two. Cheap enough
 * at this scale to not be worth a coalescing rule that could go stale.
 */
async function markRunnerSeen(
  backendId: string,
  runnerId: string,
): Promise<void> {
  const lastSeenAt = new Date();
  await db
    .insert(runners)
    .values({ backendId, runnerId, lastSeenAt })
    .onConflictDoUpdate({
      target: [runners.backendId, runners.runnerId],
      set: { lastSeenAt },
    });
}

/**
 * Hands one job to one runner, or says there is nothing.
 *
 * `for update skip locked` because a backend may well have several runner
 * processes, and two of them asking at the same instant must not be handed the
 * same row. Skipping rather than waiting is the point: a runner that blocks
 * behind another runner's row lock is a runner not doing anything, when there
 * are almost certainly other rows it could take.
 *
 * Ordered by `queued_at` rather than `created_at`: the reaper taking a job back
 * and an administrator rejudging both deliberately leave `created_at` alone,
 * so ordering by it puts every rejudged submission ahead of everything
 * submitted since. See both columns in `lib/db/schema.ts`; the queue positions
 * in `lib/submissions/queue-position.ts` count against the same clock and this
 * predicate, and the two must stay in step.
 *
 * Rows at the attempt cap are simply not selected. They are left `queued` for
 * the reaper to write off, rather than being disrupted from here, because
 * doing it here would mean a claim that finds one has to write, then look
 * again, then possibly write again — a loop, inside the one statement that is
 * on the hot path of every runner in the deployment. The reaper already exists
 * to be the thing that concludes on the kernel's behalf, and one tick of
 * latency on an already-doomed submission costs nothing.
 */
export async function claimJob(
  backendId: string,
  runnerId: string,
): Promise<JobTicket | null> {
  await markRunnerSeen(backendId, runnerId);

  const next = db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.state, "queued"),
        eq(submissions.backendId, backendId),
        lt(submissions.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(asc(submissions.queuedAt))
    .limit(1)
    .for("update", { skipLocked: true });

  const lease = mintLease();
  const now = new Date();

  const [claimed] = await db
    .update(submissions)
    .set({
      state: "judging",
      lease,
      runnerId,
      claimedAt: now,
      lastHeartbeatAt: now,
      // Cleared rather than accumulated. Whatever is in here explains why the
      // row went back in the queue, which stops being true the moment somebody
      // picks it up again — and leaving it would put a stale complaint next to
      // a running spinner.
      runnerStatus: null,
      error: null,
      attempts: sql`${submissions.attempts} + 1`,
    })
    .where(inArray(submissions.id, next))
    .returning();

  if (!claimed) return null;

  publish(toView(claimed));
  return { id: claimed.id, lease };
}

/**
 * Everything needed to evaluate, handed over only to the current holder.
 *
 * The lease check is not bookkeeping here, it is the access control. A runner
 * can name any submission id it likes, and without this a single compromised
 * evaluator could walk the id space and read every competitor's source.
 *
 * A problem missing from the registry yields a null config rather than a
 * refusal. It means the definition was deleted while a submission to it was
 * still in flight, which the runner is better placed to report on (`failed`,
 * with a reason) than the kernel is to guess about.
 */
export async function jobDetails(
  id: string,
  lease: string,
): Promise<JobDetails | null> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.id, id),
        eq(submissions.lease, lease),
        eq(submissions.state, "judging"),
      ),
    )
    .limit(1);

  if (!row) return null;

  const problem = problemBySlug(row.problemSlug);
  const config =
    problem && !isInlineBackend(problem.backend)
      ? problem.backend.config
      : null;

  // The account row cannot be missing — the foreign key is `restrict` — but
  // resolution can still fail if the enrollment rules were edited underneath
  // it, and a backend that wanted `groups` for a quota decision should get an
  // empty list rather than a 500.
  const user = await resolveUser(row.handle);

  return {
    id: row.id,
    user: { handle: row.handle, groups: user?.groups ?? [] },
    problem: { slug: row.problemSlug, config },
    contestSlug: row.contestSlug,
    payload: row.payload,
  };
}

/**
 * The guard every report shares: this row, held by this lease, still running.
 *
 * All three in one `where` rather than a read followed by a write, because the
 * reaper can requeue between the two — and then a report that was current when
 * it was checked lands on a row somebody else is now holding.
 */
function heldBy(id: string, lease: string) {
  return and(
    eq(submissions.id, id),
    eq(submissions.lease, lease),
    eq(submissions.state, "judging"),
  );
}

/**
 * "Still here."
 *
 * `status` is optional and only overwrites when supplied, so a runner may
 * heartbeat more often than it has anything new to say. What it says is not
 * read: it goes into a column and onto a page unaltered.
 */
export async function reportAlive(
  id: string,
  lease: string,
  status?: string,
): Promise<boolean> {
  const [updated] = await db
    .update(submissions)
    .set({
      lastHeartbeatAt: new Date(),
      ...(status === undefined ? {} : { runnerStatus: status }),
    })
    .where(heldBy(id, lease))
    .returning();

  if (!updated) return false;

  // Only when there was something new to say. A bare heartbeat changes nothing
  // a client renders, and pushing a frame for it would put the stream's traffic
  // under the runner's control rather than under the submission's.
  if (status !== undefined) publish(toView(updated));
  return true;
}

/** There is a verdict. */
export async function reportDone(
  id: string,
  lease: string,
  verdict: Verdict,
  backendVersion: string,
): Promise<boolean> {
  // Read before the write only because the score denominator has a fallback,
  // and every candidate for it belongs to the row rather than to anything the
  // runner asserted. Safe to do in two statements: whatever moves underneath it
  // is caught by the guard on the update, which is the only place correctness
  // rests.
  const [row] = await db
    .select({
      problemSlug: submissions.problemSlug,
      maxScore: submissions.maxScore,
    })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  if (!row) return false;

  const [updated] = await db
    .update(submissions)
    .set({
      state: "completed",
      verdict,
      backendVersion,
      // The row's own column first, because it is the older and better answer:
      // the submit route wrote the total in force when the competitor pressed
      // the button, and `rejudgeSubmissions` deliberately leaves it alone while
      // clearing everything else. The registry is the second try, for a row
      // predating that column. Null last — a problem deleted while a submission
      // to it was still in flight has no denominator, and inventing one is how
      // a late report rescores against a number nobody ever configured.
      ...verdictColumns(
        verdict,
        row.maxScore ?? problemBySlug(row.problemSlug)?.maxScore ?? null,
      ),
      error: null,
      judgedAt: new Date(),
      // The holder is done with it. Nulling the lease is what makes a duplicate
      // delivery — a retry whose first attempt succeeded — fall out at the
      // `where` clause instead of rewriting a settled row.
      lease: null,
      runnerStatus: null,
    })
    // `state = 'judging'` inside `heldBy` is the anti-rollback guard the lease
    // almost makes redundant: a row an administrator rejudged has a null lease
    // already, so a stale holder cannot match it. Kept because "a result may
    // only land on a row that is being judged" is the invariant, and stating it
    // is cheaper than reasoning every time about whether nulling the lease
    // happens to cover every path.
    .where(heldBy(id, lease))
    .returning();

  if (!updated) return false;

  publish(toView(updated));
  if (updated.contestSlug) invalidateStandings(updated.contestSlug);
  return true;
}

/**
 * There is not going to be a verdict, and the runner is saying so itself.
 *
 * Lands in `disrupted`, alongside the rows the kernel gave up on by inference.
 * Neither counts against the submitter — which is the difference between this
 * and a `system_error` verdict, and the reason the protocol has no way to
 * report one as a result.
 */
export async function reportFailed(
  id: string,
  lease: string,
  reason: string,
  backendVersion: string,
): Promise<boolean> {
  const [updated] = await db
    .update(submissions)
    .set({
      state: "disrupted",
      backendVersion,
      error: reason,
      judgedAt: new Date(),
      lease: null,
      runnerStatus: null,
    })
    .where(heldBy(id, lease))
    .returning();

  if (!updated) return false;

  publish(toView(updated));
  return true;
}
