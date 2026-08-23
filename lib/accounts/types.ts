import { z } from "zod";
import type { RoleId } from "@/lib/auth/policy";
import type { AccountStatus } from "@/lib/db/schema";

/**
 * The vocabulary of identity: what a handle and an email address look like,
 * and what the rest of the application gets when it asks who somebody is.
 *
 * Kept apart from `lib/accounts/queries.ts` so that modules needing only to
 * normalise a handle — the credentials store, the CLI, the enrollment
 * registry — do not pull in a database connection to do it.
 */

const HANDLE_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const handleSchema = z
  .string()
  .min(2, "用户名至少 2 个字符")
  .max(32, "用户名最多 32 个字符")
  .regex(HANDLE_PATTERN, "用户名只能包含字母、数字、下划线和连字符");

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .pipe(z.email("请填写有效的邮箱地址"));

/**
 * The canonical form of a handle: what the database stores and what every
 * lookup keys on. Two handles differing only in case would be
 * indistinguishable to anyone reading a standings page, so there is only ever
 * one spelling on disk.
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

/**
 * The canonical form of an address.
 *
 * Lowercasing is uncontroversial. Dropping everything after a `+` is not, in
 * general — some providers treat it as an ordinary character — but on this
 * platform an address is also the input to cohort assignment, so one mailbox
 * spelled five ways must not become five accounts in five cohorts. It stays
 * behind a policy flag because that reasoning only holds for the kind of
 * domain a deployment would put on its allowlist.
 */
export function normalizeEmail(
  email: string,
  options?: { stripSubaddress?: boolean },
): string {
  const trimmed = email.trim().toLowerCase();
  if (!options?.stripSubaddress) return trimmed;

  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  const [local] = trimmed.slice(0, at).split("+");
  // A local part that is nothing but a tag is malformed; leave it alone and
  // let validation reject it rather than inventing an address.
  return local ? `${local}${trimmed.slice(at)}` : trimmed;
}

/**
 * Who somebody is and what they may do, assembled from both sources of truth.
 *
 * `displayName` and `email` come from the database because the person supplied
 * them; `role` and `tags` come from the repository because they are decisions
 * about that person. Nothing here is stored in this shape — see
 * `lib/accounts/resolve.ts`.
 */
export interface ResolvedUser {
  handle: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  role: RoleId;
  tags: string[];
  status: AccountStatus;
  /** True when the account may not act, for whatever reason. */
  disabled: boolean;
}
