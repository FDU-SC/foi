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

  const byExpiry = [...entries.entries()].sort(
    (a, b) => expiryOf(a[1]) - expiryOf(b[1]),
  );
  const excess = entries.size - maxKeys + 1;
  for (let i = 0; i < excess; i += 1) entries.delete(byExpiry[i][0]);
}
