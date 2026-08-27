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

const cache = (globalThis.__foiStandingsCache ??= new Map<string, Entry>());
const inflight = (globalThis.__foiStandingsInflight ??= new Map<
  string,
  Promise<unknown>
>());

const eras = (globalThis.__foiStandingsEras ??= new Map<string, number>());

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

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

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

export function invalidateStandings(contestSlug: string): void {

  const prefix = `${contestSlug}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }

  for (const key of inflight.keys()) {
    if (!key.startsWith(prefix)) continue;
    eras.set(key, (eras.get(key) ?? 0) + 1);
  }
}
