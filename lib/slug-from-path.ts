/**
 * Extracts a slug from a Vite glob path given a known directory prefix.
 * E.g. slugFromGlobPath("./problems/foo/problem.ts", "problems") → "foo"
 */
export function slugFromGlobPath(
  path: string,
  prefix: string,
): string | null {
  return path.match(new RegExp(`/${prefix}/([^/]+)/[^/]+$`))?.[1] ?? null;
}
