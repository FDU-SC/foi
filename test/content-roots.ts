/**
 * Where content may live.
 *
 * `content/` is the upstream sample. `content.local/` is the slot a fork fills:
 * `tsconfig.json` resolves `@/content/*` there first and falls back per module,
 * so a deployment overrides what it needs without editing a file the upstream
 * owns — which is what makes every upstream merge conflict-free.
 *
 * The slot does not exist in this repository. Resolution, the deployment test
 * project, and the source scanners all tolerate its absence.
 */
export const CONTENT_SLOT = "content.local";

export const CONTENT_ROOTS = ["content", CONTENT_SLOT] as const;

export function isContentRoot(name: string): boolean {
  return (CONTENT_ROOTS as readonly string[]).includes(name);
}
