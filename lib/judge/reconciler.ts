import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";
import { invalidateStandings } from "@/lib/standings/cache";
import { pollJudge, resolveJudge } from "./client";

/** Give up entirely on a submission that has been unresolved this long. */
const ABANDON_AFTER_MS = 10 * 60 * 1000;

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
 * forever, so anything stale gets polled directly and, past a hard limit,
 * marked failed rather than left hanging.
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
        inArray(submissions.state, ["pending", "judging"]),
        lt(submissions.createdAt, new Date(now - reconcileAfterMs())),
      ),
    )
    .limit(BATCH_SIZE);

  let resolved = 0;
  let abandoned = 0;

  for (const row of stale) {
    const expired = now - row.createdAt.getTime() > ABANDON_AFTER_MS;

    try {
      const judge = resolveJudge(row.judgeId);
      const status = row.judgeRef
        ? await pollJudge(judge, row.judgeRef)
        : null;

      if (status?.done && status.verdict) {
        const [updated] = await db
          .update(submissions)
          .set({
            state: "completed",
            verdict: status.verdict,
            score: status.verdict.score,
            maxScore: status.verdict.maxScore,
            judgedAt: new Date(),
          })
          .where(eq(submissions.id, row.id))
          .returning();

        publish(toView(updated));
        if (updated.contestSlug) invalidateStandings(updated.contestSlug);
        resolved += 1;
        continue;
      }
    } catch {
      // Judge unreachable; fall through to the abandonment check.
    }

    if (expired) {
      const [failed] = await db
        .update(submissions)
        .set({
          state: "failed",
          error: "判题超时，未收到判题机结果",
          judgedAt: new Date(),
        })
        .where(eq(submissions.id, row.id))
        .returning();

      publish(toView(failed));
      abandoned += 1;
    }
  }

  return { checked: stale.length, resolved, abandoned };
}
