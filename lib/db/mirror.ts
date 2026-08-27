import { sql } from "drizzle-orm";
import type { ContestConfig } from "@/lib/contests/types";
import type { ProblemConfig } from "@/lib/problems/types";
import { db } from "./index";
import { contests, problems } from "./schema";

export async function ensureProblem(config: ProblemConfig): Promise<void> {
  await db
    .insert(problems)
    .values({ slug: config.slug, title: config.title })
    .onConflictDoUpdate({
      target: problems.slug,
      set: { title: sql`excluded.title`, syncedAt: sql`now()` },
    });
}

export async function ensureContest(contest: ContestConfig): Promise<void> {
  await db
    .insert(contests)
    .values({ slug: contest.slug, title: contest.title })
    .onConflictDoUpdate({
      target: contests.slug,
      set: { title: sql`excluded.title`, syncedAt: sql`now()` },
    });
}
