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
 * per-recipient half of that is handled separately and durably, by
 * `lib/auth/tokens.ts` and `lib/auth/email-verification.ts`, neither of which
 * will send to the same recipient twice within a minute; what this adds is a
 * cap on how many *different* addresses one source can aim at.
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
 * How many reverse proxies stand between the internet and this process.
 *
 * One in production: the shared Caddy at <deploy-path>, which reaches the app
 * over `caddy-network`. Set it to 0 for a deployment that publishes its own
 * port and has nothing in front of it — `docker-compose.expose.yml` does that
 * for the tailnet-only environments — which says there is no source address to
 * be had rather than pretending a header is one.
 */
function trustedProxyHops(): number {
  const raw = process.env.FOI_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === "") return 1;

  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
}

/**
 * Best-effort source address.
 *
 * Counted from the right, and that is the whole point. `x-forwarded-for` is a
 * list a client may start and each proxy appends to, so the leftmost entry is
 * whatever the client typed — not only when it reaches the app directly, which
 * is what this used to claim, but on every request that went through Caddy as
 * intended. Reading entry [0] meant anyone could pick their own bucket by
 * sending a header, and 40 attempts from one machine looked like 40 machines.
 *
 * That defeated exactly the abuse the per-source bound in `auth.ts` exists to
 * catch: spraying one password across many accounts never trips the per-handle
 * counter, so the per-source counter is the only thing watching, and it was
 * watching a number the sprayer chose.
 *
 * Entry `length - hops` is the address the outermost proxy we trust actually
 * observed. Anything to its left was supplied by the peer and is ignored.
 */
export function sourceFrom(store: Headers): string {
  const hops = trustedProxyHops();

  // With nothing trusted in front, both headers can only have come from the
  // peer. One bucket for everyone is a weaker limit, but it is an honest one.
  if (hops === 0) return "direct";

  const chain = (store.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // A chain shorter than the configured hop count means fewer proxies appended
  // than this deployment claims to have, so every entry in it may be the
  // peer's own. Not read: a wrong `FOI_TRUSTED_PROXY_HOPS` should degrade to
  // one coarse bucket, never to a bucket the sender picks.
  if (chain.length >= hops) return chain[chain.length - hops];

  // Only reachable when no trusted proxy appended anything, which behind Caddy
  // never happens — it appends on every request. Kept for deployments fronted
  // by something that sets `x-real-ip` instead, and no more trustworthy than
  // that proxy is.
  return store.get("x-real-ip")?.trim() || "unknown";
}

export async function clientIp(): Promise<string> {
  return sourceFrom(await headers());
}
