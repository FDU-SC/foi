/**
 * Client-visible content discovery. Kept separate from `_globs.ts` so that
 * importing per-problem views never drags `server-only` problem configs or
 * inline judges into the browser bundle.
 *
 * Lives at the content root for the same reason as `_globs.ts`: Turbopack's
 * `import.meta.glob` silently returns `{}` for patterns containing `..`
 * (vercel/next.js#95496).
 */

export const problemViewModules = import.meta.glob("./problems/*/views.tsx", {
  eager: true,
});
