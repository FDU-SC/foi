/**
 * Small in-process cache for computed standings.
 *
 * Deliberately not Next's `revalidateTag`: that only works inside a request
 * scope, and the reaper's background loop settles submissions outside one.
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
  var __foiStandingsEras: Map<string, number> | undefined;
}

const DEFAULT_TTL_MS = 10_000;

// Attached unconditionally, not just in development. A second copy of this
// module in another server bundle would be a second cache, and the one that
// `invalidateStandings` clears would not be the one the standings page reads —
// so a verdict would land and the board would keep serving the old figures
// until the TTL ran out, with nothing to indicate why. The counter below is
// attached for the same reason and would fail the same way: split in two, a
// recompute would compare its era against one nobody had incremented.
const cache = (globalThis.__foiStandingsCache ??= new Map<string, Entry>());
const inflight = (globalThis.__foiStandingsInflight ??= new Map<
  string,
  Promise<unknown>
>());

/**
 * How many times each key has been invalidated.
 *
 * Deleting the cache entry is only half of an invalidation. A recompute that
 * is already in flight read its rows before the verdict landed, and its `.then`
 * would put those rows straight back — so the entry the invalidation removed
 * comes back stale and is served for a full TTL, which is the outcome the
 * invalidation existed to prevent. The number lets a recompute recognise on
 * the way out that the world moved under it.
 */
const eras = (globalThis.__foiStandingsEras ??= new Map<string, number>());

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

  // Read before the work starts, and compared after. `invalidateStandings` is
  // synchronous, so anything that begins after one has already picked up the
  // new number — which is what makes a single comparison enough.
  const startedIn = eras.get(key) ?? 0;

  const promise = compute()
    .then((value) => {
      // Still the era this began in, so nothing has happened that these
      // figures do not already account for. Otherwise the value is still
      // handed to whoever is waiting on it — they get a board a moment behind
      // rather than a second trip to the database — but it is not written
      // down, so the next reader recomputes instead of being served it for the
      // whole TTL.
      if ((eras.get(key) ?? 0) === startedIn) {
        cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
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

  // Only the keys with a recompute in the air: those are the ones that can
  // write, and bumping an era for a key nobody is computing would leave an
  // entry in a map with nothing to trim it. In flight the count is bounded by
  // the contests that exist times the two variants.
  for (const key of inflight.keys()) {
    if (!key.startsWith(prefix)) continue;
    eras.set(key, (eras.get(key) ?? 0) + 1);
  }
}
