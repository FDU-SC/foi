import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems } from "@/lib/db/schema";
import type { ProblemConfig } from "./types";

/**
 * Upserts a problem's mirror row, called just before a submission references
 * it.
 *
 * This is the only thing that writes to `problems`. Startup used to push the
 * whole registry in, which made the table look like a mirror of
 * `content/problems`; it is not, and never needed to be. The foreign key wants
 * a row at exactly one moment — the insert below it in
 * `app/api/submissions/route.ts` — and what the table ends up holding is the
 * problems somebody has actually submitted to, including ones since deleted
 * from the repository. That is what keeps their submissions attributable.
 *
 * The title tracks the registry rather than freezing at first submission: a
 * slug is the identity and a title is a display name, so a renamed problem
 * should read the same everywhere it appears.
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
