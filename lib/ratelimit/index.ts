import { headers } from "next/headers";
import { createFixedWindow, type RateLimitResult } from "./window";
import { sourceFrom } from "./source";

/**
 * The counter every route handler and Server Action shares.
 *
 * Single-process, in memory. Same assumption the submission event bus makes:
 * one Node process is enough at this scale, and the note in the README about
 * moving SSE to LISTEN/NOTIFY applies here too — a second process would need
 * this in Postgres or Redis to mean anything.
 *
 * This guards the endpoints that cost something to an outsider: signing up and
 * asking for a password reset both send mail, and an unmetered form that sends
 * mail is a way to have somebody else's inbox filled from your domain. The
 * per-recipient half of that is handled separately and durably, by
 * `lib/auth/tokens.ts` and `lib/auth/email-verification.ts`, neither of which
 * will send to the same recipient twice within a minute; what this adds is a
 * cap on how many *different* addresses one source can aim at.
 *
 * Which entry points are bounded, and by how much, is `./policy.ts`.
 */

declare global {
  var __foiRateLimit: ReturnType<typeof createFixedWindow> | undefined;
}

/**
 * Attached to `globalThis`, not module scope, and not only in development.
 * Next can place a module in more than one server bundle, and a counter that
 * exists once per bundle silently multiplies every limit by the number of
 * copies.
 *
 * `proxy.ts` deliberately does *not* join this one. Next's documentation says
 * proxy code should not rely on shared modules or globals, and it does not
 * need to: the global layer counts sources, this one counts people, and two
 * layers that never share a key have nothing to gain from sharing a map.
 */
const window = (globalThis.__foiRateLimit ??= createFixedWindow({
  // Keyed by handle for most callers, so growth is bounded by the account
  // table rather than by the internet — but not all of them, and a ceiling
  // that is never reached costs nothing.
  maxKeys: 10_000,
}));

export type { RateLimitResult };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  return window.take(key, limit, windowMs);
}

export { sourceFrom };

export async function clientIp(): Promise<string> {
  return sourceFrom(await headers());
}
