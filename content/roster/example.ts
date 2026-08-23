import type { RosterEntryInput } from "@/lib/roster/types";

/**
 * The development roster, and the worked example for how a real one looks.
 *
 * These four handles are what `pnpm db:seed` gives a password to, and what
 * `scripts/demo-data.sql` attributes its demo submissions to. Real cohorts
 * belong in their own file next to this one — `2026-spring.ts` and so on —
 * which is also why they stay out of the public mirror: only this example
 * file is on the allowlist in `.github/workflows/sync-public.yml`.
 */
export const members: RosterEntryInput[] = [
  { handle: "admin", displayName: "管理员", role: "admin", tags: ["demo"] },
  { handle: "alice", displayName: "Alice", tags: ["demo"] },
  { handle: "bob", displayName: "Bob", tags: ["demo"] },
  { handle: "carol", displayName: "Carol", tags: ["demo"] },
];
