import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { listGrants } from "@/lib/enrollment/registry";
import { invalidateAccounts } from "./cache";
import { normalizeHandle } from "./types";

/**
 * Materialises the accounts the repository declares.
 *
 * Almost nobody is declared: registration is how people get in. What is left
 * are the bootstrap administrator — who has to exist before anyone can be
 * granted anything, and whose password is set over the CLI — and the handful
 * of people whose privileges cannot be derived from their address.
 *
 * Runs at startup next to `syncProblems()` and `syncContests()`, for the same
 * reason they do: a deploy should be consistent before it serves a request. A
 * declared handle needs a row before a foreign key can point at it.
 */
export async function syncGrants(): Promise<{ synced: number }> {
  // A grant naming somebody who registered normally is about their
  // privileges; there is no account to materialise and nothing to seed a
  // display name from. Only entries carrying one are bootstrap accounts.
  const declared = listGrants().filter((grant) => grant.displayName);
  if (declared.length === 0) return { synced: 0 };

  await db
    .insert(accounts)
    .values(
      declared.map((grant) => ({
        handle: normalizeHandle(grant.handle),
        displayName: grant.displayName as string,
        source: "bootstrap" as const,
        status: "active" as const,
      })),
    )
    .onConflictDoUpdate({
      target: accounts.handle,
      set: {
        displayName: sql`excluded.display_name`,
        updatedAt: new Date(),
      },
      // Only a bootstrap account takes its display name from the repository.
      // Somebody who registered chose their own, and a grant naming them is
      // about their privileges, not about what they are called.
      setWhere: eq(accounts.source, "bootstrap"),
    });

  invalidateAccounts();
  return { synced: declared.length };
}
