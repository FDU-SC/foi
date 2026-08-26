/**
 * Making room in a map whose keys somebody else chooses.
 *
 * Two of these exist in the process — the rate limiter's buckets in
 * `lib/ratelimit/window.ts` and the claim endpoint's spent nonces in
 * `lib/runner/replay.ts` — and they need the same two steps: drop what has
 * expired, and if that was not enough, shed the entries closest to expiring
 * anyway. What differs between them is only where the expiry lives on a value,
 * which is the parameter.
 *
 * Why either has a ceiling at all is not here, because it is not the same
 * argument twice: one is guarding against an outsider who can mint keys for
 * free, the other against a fleet of runners that has already proved it holds
 * a key. Both are argued on the `maxKeys` each of them documents.
 */
export function makeRoom<V>(
  entries: Map<string, V>,
  expiryOf: (value: V) => number,
  now: number,
  maxKeys: number,
): void {
  for (const [key, value] of entries) {
    if (expiryOf(value) <= now) entries.delete(key);
  }

  if (entries.size < maxKeys) return;

  // Still full after dropping the expired ones, which is what a flood of
  // distinct keys looks like. Shed the ones nearest their own expiry: they are
  // the entries closest to being forgotten regardless, so it is the least each
  // caller loses.
  const byExpiry = [...entries.entries()].sort(
    (a, b) => expiryOf(a[1]) - expiryOf(b[1]),
  );
  const excess = entries.size - maxKeys + 1;
  for (let i = 0; i < excess; i += 1) entries.delete(byExpiry[i][0]);
}
