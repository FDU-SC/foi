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

const cache = globalThis.__foiStandingsCache ?? new Map<string, Entry>();
const inflight =
  globalThis.__foiStandingsInflight ?? new Map<string, Promise<unknown>>();

if (process.env.NODE_ENV !== "production") {
  globalThis.__foiStandingsCache = cache;
  globalThis.__foiStandingsInflight = inflight;
}

export async function cachedStandings<T>(
  contestId: string,
  compute: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = cache.get(contestId);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  // Collapse concurrent misses so a burst of viewers triggers one recompute.
  const pending = inflight.get(contestId);
  if (pending) return pending as Promise<T>;

  const promise = compute()
    .then((value) => {
      cache.set(contestId, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(contestId);
    });

  inflight.set(contestId, promise);
  return promise;
}

/** Called after a verdict lands so the next standings read recomputes. */
export function invalidateStandings(contestId: string): void {
  cache.delete(contestId);
}
