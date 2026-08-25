import { headers } from "next/headers";
import { createFixedWindow, type RateLimitResult } from "./window";
import { isResolvedSource, sourceFrom } from "./source";

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
 * cap on how many *different* addresses one source can aim at — for as long as
 * there is a source to count, which `rateLimitBySource` below is where that
 * qualifier lives.
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

/**
 * A bound keyed on where the request came from, which stands aside when there
 * is nowhere to key it on.
 *
 * The skip is the whole reason this exists rather than each caller writing
 * `rateLimit(\`x:${source}\`, …)`, which is what they all used to do. When
 * nothing trusted sits in front, `sourceFrom` reports a sentinel rather than
 * inventing an address, and a counter keyed on a sentinel is not a weaker
 * per-source bound — it is one budget shared by everybody who reaches the
 * deployment. On a tailnet box with `FOI_TRUSTED_PROXY_HOPS=0` that turned the
 * registration form into ten signups an hour *in total* and password recovery
 * into ten links an hour *in total*, which two people setting up on the same
 * afternoon would exhaust between them. A flood cap that becomes an outage
 * under ordinary use is worse than no flood cap.
 *
 * `proxy.ts` and `./gate.ts` had already reasoned their way to this and
 * skipped; the six call sites that build a key from the sentinel had not, so
 * the same misconfiguration meant two different things depending on which
 * layer you asked. They now ask this, and `isResolvedSource` is the one place
 * that decides.
 *
 * Failing open is also the right direction for what a source-keyed bound *is*.
 * It raises the cost of volume; it is not what stops anybody doing anything.
 * The bounds that do that are keyed on a handle or on a mailbox — the login
 * counter's first half, and the durable per-recipient cooldowns in
 * `lib/auth/tokens.ts` and `lib/auth/email-verification.ts` — and none of them
 * are affected by what the proxy header says.
 */
export function rateLimitBySource(
  activity: string,
  source: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  if (!isResolvedSource(source)) return { ok: true };
  return rateLimit(`${activity}:${source}`, limit, windowMs);
}

/**
 * The same bound, for a caller that can ask the framework who is on the line.
 *
 * This is what `clientIp()` became. That function handed back a source string
 * and left every Server Action to build a key out of it, which meant the
 * sentinel case had to be remembered five times and was remembered nowhere —
 * the reason the argument above is written on the function that takes the
 * source rather than here.
 *
 * `authorize` in `auth.ts` cannot use this one and calls `rateLimitBySource`
 * directly: it is handed the `Request` and must work wherever Auth.js invokes
 * the provider, which is not necessarily somewhere `next/headers` resolves.
 */
export async function rateLimitByCaller(
  activity: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return rateLimitBySource(
    activity,
    sourceFrom(await headers()),
    limit,
    windowMs,
  );
}
