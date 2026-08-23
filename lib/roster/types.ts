import { z } from "zod";
import { ROLE_IDS } from "@/lib/auth/policy";

/**
 * One person, as declared in `content/roster/*.ts`.
 *
 * Everything about an account except the password lives here: who they are,
 * what they may do, whether they are still active. The database holds no copy
 * — `lib/auth` reads this registry on every request, so editing the roster
 * takes effect for sessions that are already open.
 */
export const rosterEntrySchema = z.object({
  handle: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, "用户名只能包含字母、数字、下划线和连字符"),
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

/**
 * The canonical form of a handle: what the database stores and what registry
 * lookups key on. Declared here rather than in the registry so that modules
 * touching only the database do not pull in the whole roster.
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}
