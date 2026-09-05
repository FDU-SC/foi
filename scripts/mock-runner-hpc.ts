export type ParallelComparison = "float" | "exact";
export type ParallelScoring = "speedup" | "correctness";

export function floatClose(
  actual: string,
  expected: string,
  tolerance: number,
): boolean {
  const x = Number(actual.trim());
  const y = Number(expected.trim());
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= tolerance * Math.max(1, Math.abs(y));
}

export function parallelOutputMatches(
  actual: string,
  expected: string,
  comparison: ParallelComparison | undefined,
  tolerance: number,
): boolean {
  return comparison === "exact"
    ? actual.trim() === expected.trim()
    : floatClose(actual, expected, tolerance);
}

export function parallelScore(
  baselineMs: number,
  timeMs: number,
  scoring: ParallelScoring | undefined,
): number {
  return scoring === "correctness"
    ? 100
    : Math.min(100, Math.floor((50 * baselineMs) / timeMs));
}
