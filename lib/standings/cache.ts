/**
 * Small in-process cache for computed standings.
 *
 * Deliberately not Next's `revalidateTag`: that only works inside a request
 * scope, and the reconciler's background sweep resolves verdicts outside one.
 * At internal-contest scale a full recompute is cheap, so a short TTL plus
 * explicit invalidation from both paths is simpler and more predictable.
 */
interface Entry {
  value: unknown;
  expiresAt: number;
}

declare global {
  var __foiStandingsCache: Map<string, Entry> | undefined;
  var __foiStandingsInflight: Map<string, Promise<unknown>> | undefined;
}

const DEFAULT_TTL_MS = 10_000;

// Attached unconditionally, not just in development. A second copy of this
// module in another server bundle would be a second cache, and the one that
// `invalidateStandings` clears would not be the one the standings page reads —
// so a verdict would land and the board would keep serving the old figures
// until the TTL ran out, with nothing to indicate why.
const cache = (globalThis.__foiStandingsCache ??= new Map<string, Entry>());
const inflight = (globalThis.__foiStandingsInflight ??= new Map<
  string,
  Promise<unknown>
>());

/**
 * One contest can have more than one board.
 *
 * A viewer entitled to read everyone's submissions sees through a freeze, so
 * the frozen and unfrozen forms are both live at once and must not share an
 * entry — caching by slug alone would serve whichever was computed first to
 * everybody.
 */
export function standingsKey(contestSlug: string, variant: string): string {
  return `${contestSlug}::${variant}`;
}

export async function cachedStandings<T>(
  key: string,
  compute: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  // Collapse concurrent misses so a burst of viewers triggers one recompute.
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = compute()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Called after a verdict lands so the next standings read recomputes. */
export function invalidateStandings(contestSlug: string): void {
  // Every variant of this contest, since a verdict changes all of them.
  const prefix = `${contestSlug}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
