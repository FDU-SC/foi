import { sql } from "drizzle-orm";
import type { ContestConfig } from "@/lib/contests/types";
import type { ProblemConfig } from "@/lib/problems/types";
import { db } from "./index";
import { contests, problems } from "./schema";

/**
 * The two mirror rows, upserted just before a submission references them.
 *
 * These are the only things that write to `problems` and `contests`, and
 * nothing pushes the registry in at startup: the tables are not a mirror of
 * `content/`. The foreign keys want a row at exactly one moment — the insert
 * in `app/api/submissions/route.ts` — so what the tables hold is what somebody
 * has actually submitted to, including entries since deleted from the
 * repository. That is what keeps their submissions attributable; `/admin`
 * reports such a row rather than anything detaching the history on its own.
 *
 * One file for both because they are the same eight-line upsert but for the
 * table, and their only caller is the submission route, which needs both in
 * the same request.
 *
 * The title tracks the registry rather than freezing at first submission: a
 * slug is the identity and a title is a display name, so a renamed problem or
 * round should read the same everywhere it appears.
 */

export async function ensureProblem(config: ProblemConfig): Promise<void> {
  await db
    .insert(problems)
    .values({ slug: config.slug, title: config.title })
    .onConflictDoUpdate({
      target: problems.slug,
      set: { title: sql`excluded.title`, syncedAt: new Date() },
    });
}

export async function ensureContest(contest: ContestConfig): Promise<void> {
  await db
    .insert(contests)
    .values({ slug: contest.slug, title: contest.title })
    .onConflictDoUpdate({
      target: contests.slug,
      set: { title: sql`excluded.title`, syncedAt: new Date() },
    });
}
