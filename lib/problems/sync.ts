import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems } from "@/lib/db/schema";
import { allProblems } from "./registry";
import type { ProblemConfig } from "./types";

/**
 * Upserts a single problem before it is referenced by a submission.
 *
 * The startup sync only sees problems that existed when the server booted, so
 * without this a problem added during `next dev` would fail the submissions
 * foreign key until the next restart.
 */
export async function ensureProblem(config: ProblemConfig): Promise<void> {
  await db
    .insert(problems)
    .values({
      slug: config.slug,
      title: config.title,
      maxScore: config.maxScore,
    })
    .onConflictDoUpdate({
      target: problems.slug,
      set: {
        title: sql`excluded.title`,
        maxScore: sql`excluded.max_score`,
        syncedAt: new Date(),
      },
    });
}

/**
 * Pushes the filesystem registry into the mirror table.
 *
 * Has to run inside the Next.js runtime because the registry is built by
 * Turbopack's `import.meta.glob`, which a standalone script cannot evaluate.
 */
export async function syncProblems(): Promise<{ synced: number }> {
  const all = allProblems();
  if (all.length === 0) return { synced: 0 };

  await db
    .insert(problems)
    .values(
      all.map((problem) => ({
        slug: problem.slug,
        title: problem.title,
        maxScore: problem.maxScore,
      })),
    )
    .onConflictDoUpdate({
      target: problems.slug,
      set: {
        title: sql`excluded.title`,
        maxScore: sql`excluded.max_score`,
        syncedAt: new Date(),
      },
    });

  return { synced: all.length };
}
