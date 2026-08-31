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
 *
 * Plain ESM JavaScript on purpose: `vitest.config.mts` imports this, and a
 * config loaded natively cannot pull in a TypeScript module.
 */

export const CONTENT_SLOT = "content.local";

export const CONTENT_ROOTS = ["content", CONTENT_SLOT];

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isContentRoot(name) {
  return CONTENT_ROOTS.includes(name);
}
