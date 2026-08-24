/**
 * A fixed-window counter, with the storage left to the caller.
 *
 * There are two of these in the process and they must not be the same one.
 * `./index.ts` keeps the counter every route handler and Server Action shares;
 * `proxy.ts` keeps its own, because Next's documentation says outright that
 * proxy code "should not attempt relying on shared modules or globals". That
 * is fine — the two layers count different things under different keys, and
 * never needed to see each other's tallies. What they should share is the
 * arithmetic, which is what this is.
 *
 * A window starts at the first request for a key and lasts `windowMs`
 * regardless of what arrives afterwards. That is coarser than a sliding
 * window: a caller can spend a whole budget at the end of one window and
 * another at the start of the next. Accepted deliberately — every bound here
 * is sized so that twice it is still not a problem, and a sliding window costs
 * a per-key list of timestamps rather than a pair of numbers.
 */

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

interface Window {
  count: number;
  resetAt: number;
}

export interface FixedWindow {
  take(key: string, limit: number, windowMs: number): RateLimitResult;
  /** Live key count. Exposed for tests and for the eviction assertions. */
  size(): number;
}

export interface FixedWindowOptions {
  /**
   * Hard ceiling on distinct keys held at once.
   *
   * The point is not memory tidiness, it is that the key space is chosen by
   * whoever is calling. A counter keyed on an address is a map an outsider
   * writes into: one request per forged source is one entry, and without a
   * ceiling "how many buckets exist" is a number the internet decides. Sweeping
   * expired entries is not enough on its own, because entries that have not
   * expired yet are exactly what a flood produces.
   *
   * When full, the oldest-expiring entries go first. That is the least wrong
   * eviction available: it drops the keys closest to being forgotten anyway,
   * and the counters it does lose fail open rather than locking somebody out.
   */
  maxKeys: number;
}

export function createFixedWindow(options: FixedWindowOptions): FixedWindow {
  const buckets = new Map<string, Window>();

  function evict(now: number): void {
    for (const [key, window] of buckets) {
      if (window.resetAt <= now) buckets.delete(key);
    }

    if (buckets.size < options.maxKeys) return;

    // Still full after dropping the expired ones, which is what a flood of
    // distinct keys looks like. Shed the ones nearest their own expiry.
    const byExpiry = [...buckets.entries()].sort(
      (a, b) => a[1].resetAt - b[1].resetAt,
    );
    const excess = buckets.size - options.maxKeys + 1;
    for (let i = 0; i < excess; i += 1) buckets.delete(byExpiry[i][0]);
  }

  return {
    take(key, limit, windowMs) {
      const now = Date.now();

      const window = buckets.get(key);
      if (window && window.resetAt > now) {
        if (window.count >= limit) {
          return { ok: false, retryAfterMs: window.resetAt - now };
        }
        window.count += 1;
        return { ok: true };
      }

      // A new key, or one whose window has passed. Only now is it worth
      // walking the map: an existing key in an open window is the common case
      // and costs one lookup.
      if (buckets.size >= options.maxKeys) evict(now);
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    },

    size: () => buckets.size,
  };
}
