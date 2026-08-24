import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";
import { verdictColumns } from "@/lib/submissions/verdict";
import { invalidateStandings } from "@/lib/standings/cache";
import {
  DEFAULT_ABANDON_MS,
  pollJudge,
  resolveBackend,
  type ResolvedBackend,
} from "./client";
import { NON_TERMINAL_STATES } from "./types";

const BATCH_SIZE = 50;

function reconcileAfterMs(): number {
  const seconds = Number(process.env.FOI_JUDGE_RECONCILE_AFTER ?? 30);
  return (Number.isFinite(seconds) ? seconds : 30) * 1000;
}

/**
 * Second channel for judge results.
 *
 * Callbacks get lost — proxies time out, judges restart mid-run, retry budgets
 * run out. Without this sweep those submissions would sit in `judging`
 * forever, so anything stale gets polled directly and, past the backend's
 * deadline, marked `abandoned` rather than left hanging.
 *
 * `abandoned` and not `failed`, because everything this function concludes it
 * concludes from silence. A late verdict is still welcome on those rows — see
 * `acceptsVerdict` in `./types` — which is the difference between guessing and
 * being told.
 */
export async function reconcileStaleSubmissions(): Promise<{
  checked: number;
  resolved: number;
  abandoned: number;
}> {
  const now = Date.now();
  const stale = await db
    .select()
    .from(submissions)
    .where(
      and(
        inArray(submissions.state, NON_TERMINAL_STATES),
        lt(submissions.createdAt, new Date(now - reconcileAfterMs())),
      ),
    )
    // Oldest first, because the batch is capped and the cap is reached exactly
    // when it matters: a backlog wider than `BATCH_SIZE` under an unordered
    // limit is Postgres' choice of fifty rows, and the ones it keeps skipping
    // are the ones closest to their deadline. `submissions_pending_idx` is on
    // `(state, created_at)`, so the order costs nothing.
    .orderBy(asc(submissions.createdAt))
    .limit(BATCH_SIZE);

  let resolved = 0;
  let abandoned = 0;

  for (const row of stale) {
    let backend: ResolvedBackend | null = null;
    try {
      backend = resolveBackend(row.backendId);
    } catch {
      // The configuration no longer names this backend, or its secret has gone
      // missing. Nothing can be polled, but the deadline still applies —
      // otherwise a typo in an environment variable would leave every
      // in-flight submission unresolved for good.
    }

    // The deadline belongs to the backend, not to this module: judging times
    // differ by orders of magnitude between a flag check and a performance
    // baseline, and a single constant has to be wrong for one of them. The
    // fallback covers the rows whose backend did not resolve above.
    const expired =
      now - row.createdAt.getTime() >
      (backend?.abandonAfterMs ?? DEFAULT_ABANDON_MS);

    try {
      // `row.id` when the backend named no reference of its own. The protocol
      // makes `judgeRef` optional, and those rows previously had no way out
      // but the deadline — nothing polled them, so a lost callback cost the
      // full window and then a guess. The submission id is the one identifier
      // both ends are certain to share, since the dispatch carried it, so it
      // is what a backend keying on the request itself would answer to. One
      // that does not recognise it answers 404, `pollJudge` returns null, and
      // the row is left exactly where it was.
      const status = backend
        ? await pollJudge(backend, row.judgeRef ?? row.id)
        : null;

      if (status?.done && status.verdict) {
        const [updated] = await db
          .update(submissions)
          .set({
            state: "completed",
            verdict: status.verdict,
            backendVersion: status.backendVersion,
            ...verdictColumns(status.verdict, row.problemSlug),
            // Same reason the callback clears it: a dispatch whose outcome was
            // unknown left its reason here and deliberately left the row open,
            // and this is that row turning out fine.
            error: null,
            judgedAt: new Date(),
          })
          .where(
            and(
              eq(submissions.id, row.id),
              inArray(submissions.state, NON_TERMINAL_STATES),
            ),
          )
          .returning();

        // No row means the callback arrived while we were polling. It wrote
        // the same verdict we just fetched, so there is nothing left to do.
        if (updated) {
          publish(toView(updated));
          if (updated.contestSlug) invalidateStandings(updated.contestSlug);
          resolved += 1;
        }
        continue;
      }
    } catch {
      // Judge unreachable; fall through to the abandonment check.
    }

    if (expired) {
      // `row` was read before the poll above, which can take as long as the
      // judge's timeout. Guarding on the state is what stops this from
      // rewriting a verdict that landed by callback in the meantime.
      //
      // `judgedAt` is set even though nothing judged this: the column is what
      // every reader uses for "when did this stop moving", and leaving it null
      // would show an abandoned row as still in flight.
      const [givenUp] = await db
        .update(submissions)
        .set({
          state: "abandoned",
          error: "评测超时，未收到题目后端结果",
          judgedAt: new Date(),
        })
        .where(
          and(
            eq(submissions.id, row.id),
            inArray(submissions.state, NON_TERMINAL_STATES),
          ),
        )
        .returning();

      if (givenUp) {
        publish(toView(givenUp));
        abandoned += 1;
      }
    }
  }

  return { checked: stale.length, resolved, abandoned };
}
