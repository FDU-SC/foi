import { z } from "zod";
import { handleSchema } from "@/lib/accounts/types";
import { ROLE_IDS } from "@/lib/auth/policy";

/**
 * One person, as declared in `content/roster/*.ts`.
 *
 * Identity has moved to the `accounts` table — the display name here is only
 * what a declared account is seeded with. What the repository still decides is
 * everything below it: the role, the cohort tags, whether the entry is
 * suspended. `lib/accounts/resolve.ts` reads this registry on every request,
 * so editing it takes effect for sessions that are already open.
 */
export const rosterEntrySchema = z.object({
  handle: handleSchema,
  displayName: z.string().min(1).max(64),
  role: z.enum(ROLE_IDS).default("user"),

  /**
   * Free-form labels. Contests select their participants by tag, so a cohort
   * is expressed once here rather than repeated in every contest file.
   */
  tags: z.array(z.string()).default([]),

  /**
   * Blocks login while keeping the person's submissions attributable. Prefer
   * this over deleting the entry: a deleted handle leaves its submissions
   * pointing at nobody.
   */
  disabled: z.boolean().default(false),
});

export type RosterEntry = z.infer<typeof rosterEntrySchema>;
export type RosterEntryInput = z.input<typeof rosterEntrySchema>;
