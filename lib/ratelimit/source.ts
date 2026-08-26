/**
 * Where a request came from, as well as this process can know.
 *
 * Split out from `./index.ts` for one mechanical reason: that module reaches
 * for `next/headers`, which `proxy.ts` may not call. Both layers need to agree
 * on what counts as a source — a global bound in the proxy and a per-endpoint
 * one in a route handler counting different things for the same caller would
 * be two limits pretending to be one — so the derivation lives here, importing
 * nothing.
 *
 * There is no better answer available. `NextRequest.ip` was removed in v15 and
 * the App Router exposes no way to read the socket's peer address, in a route
 * handler or in proxy alike. Whatever sits in front has to tell us, and the
 * only question is how much of what it says to believe.
 */

/**
 * How many reverse proxies stand between the internet and this process.
 *
 * Deliberately configuration rather than something derived. The obvious
 * instinct is to read it off the compose overlay — production goes through the
 * shared Caddy, dev and staging publish their own port — but the overlay does
 * not know what an operator has put in front of it, and the reverse proxy here
 * is explicitly swappable. A deployment that later moves behind a CDN gains a
 * hop that nothing in this repository can see.
 *
 * A wrong value does not fail loudly, it silently changes what every limit
 * counts by, which is why `lib/env.ts` validates it even though it is optional.
 */
function trustedProxyHops(): number {
  const raw = process.env.FOI_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === "") return 1;

  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
}

/**
 * The two answers that mean "no source could be established".
 *
 * Not addresses, and callers have to be able to tell. A bound keyed on a
 * sentinel is not a weaker version of a per-source bound — it is every caller
 * sharing one budget, which turns a flood cap into an outage the moment two
 * people use the deployment at once. So every source-keyed bound skips rather
 * than lumps, and they all reach that decision through `rateLimitBySource` in
 * `./index.ts` rather than each remembering to ask.
 *
 * The list itself is not exported, and `isResolvedSource` is. Handing out the
 * strings would invite a comparison against one of them somewhere, which is a
 * second spelling of a question that has to have one answer — `proxy.ts` is
 * the one caller outside this directory and it asks the predicate.
 */
const UNRESOLVED_SOURCES = ["direct", "unknown"] as const;

export function isResolvedSource(source: string): boolean {
  return !(UNRESOLVED_SOURCES as readonly string[]).includes(source);
}

/**
 * Best-effort source address, counted from the right.
 *
 * `x-forwarded-for` is a list a client may start and each proxy appends to, so
 * the leftmost entry is whatever the client typed — on every request, not only
 * on one that reached the app directly. Reading entry [0] lets anyone pick
 * their own bucket by sending a header, so 40 attempts from one machine look
 * like 40 machines.
 *
 * That would defeat exactly the abuse the per-source bound in `auth.ts` exists
 * to catch: spraying one password across many accounts never trips the
 * per-handle counter, so the per-source counter is the only thing watching.
 *
 * Entry `length - hops` is the address the outermost proxy we trust actually
 * observed. Anything to its left was supplied by the peer and is ignored.
 */
export function sourceFrom(store: Headers): string {
  const hops = trustedProxyHops();

  // With nothing trusted in front, both headers can only have come from the
  // peer, so there is no source to be had. Says so rather than inventing one:
  // `docker-compose.expose.yml` publishes its own port for the tailnet
  // environments, and that is the honest answer there.
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
