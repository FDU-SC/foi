interface Entry {
  value: unknown;
  expiresAt: number;
}

declare global {
  var __foiStandingsCache: Map<string, Entry> | undefined;
  var __foiStandingsInflight: Map<string, Promise<unknown>> | undefined;
  var __foiStandingsEras: Map<string, number> | undefined;
  var __foiStandingsTags: Map<string, readonly string[]> | undefined;
}

const DEFAULT_TTL_MS = 10_000;

const cache = (globalThis.__foiStandingsCache ??= new Map<string, Entry>());
const inflight = (globalThis.__foiStandingsInflight ??= new Map<
  string,
  Promise<unknown>
>());

const eras = (globalThis.__foiStandingsEras ??= new Map<string, number>());

/** The contests each key was computed from; a board may span several. */
const tags = (globalThis.__foiStandingsTags ??= new Map<string, readonly string[]>());

export function standingsKey(scope: string, variant: string): string {
  return `${scope}::${variant}`;
}

/**
 * `compute`'s result under `key`, shared for a short while. `contests` names
 * every contest the result read, so a change to any of them invalidates it.
 */
export async function cachedStandings<T>(
  key: string,
  contests: readonly string[],
  compute: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  tags.set(key, contests);
  const startedIn = eras.get(key) ?? 0;

  const promise = compute()
    .then((value) => {

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

/** Drop every cached board that read this contest, and void those still computing. */
export function invalidateStandings(contestSlug: string): void {
  for (const [key, read] of tags) {
    if (!read.includes(contestSlug)) continue;

    cache.delete(key);
    if (inflight.has(key)) eras.set(key, (eras.get(key) ?? 0) + 1);
    else tags.delete(key);
  }
}
