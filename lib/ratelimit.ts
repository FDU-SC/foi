import { headers } from "next/headers";

/**
 * A fixed-window counter, in memory.
 *
 * Same single-process assumption the submission event bus makes: one Node
 * process is enough at this scale, and the note in the README about moving SSE
 * to LISTEN/NOTIFY applies here too — a second process would need this in
 * Postgres or Redis to mean anything.
 *
 * This guards the endpoints that cost something to an outsider: signing up and
 * asking for a password reset both send mail, and an unmetered form that sends
 * mail is a way to have somebody else's inbox filled from your domain. The
 * per-recipient half of that is handled separately and durably in
 * `lib/auth/tokens.ts`, which will not mint a second token within a minute;
 * what this adds is a cap on how many *different* addresses one source can
 * aim at.
 */
interface Window {
  count: number;
  resetAt: number;
}

declare global {
  var __foiRateLimit: Map<string, Window> | undefined;
}

// Attached unconditionally, not just in development. Next can place a module
// in more than one server bundle, and a counter that exists once per bundle
// silently multiplies every limit below by the number of copies.
const buckets = (globalThis.__foiRateLimit ??= new Map<string, Window>());

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  // Expired windows are dropped as they are touched, plus a sweep whenever the
  // map has grown enough to be worth walking. Without it a burst of unique
  // keys would pin their memory until restart.
  if (buckets.size > 1000) {
    for (const [key, window] of buckets) {
      if (window.resetAt <= now) buckets.delete(key);
    }
  }

  const window = buckets.get(key);
  if (!window || window.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (window.count >= limit) {
    return { ok: false, retryAfterMs: window.resetAt - now };
  }

  window.count += 1;
  return { ok: true };
}

/**
 * Best-effort source address.
 *
 * Behind the reverse proxy this is `x-forwarded-for`, whose first entry is the
 * client. It is spoofable by anything that can reach the app directly, so this
 * is a cost-raiser and not a security boundary — the durable per-recipient
 * throttle is what actually bounds how much mail one person can be sent.
 */
export async function clientIp(): Promise<string> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return store.get("x-real-ip") ?? "unknown";
}
