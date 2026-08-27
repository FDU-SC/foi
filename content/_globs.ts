import "server-only";

/**
 * Glob-based content discovery for everything the platform loads server-side.
 *
 * This file lives at the content root, and every pattern only ever descends,
 * because Turbopack's `import.meta.glob` silently returns `{}` for any pattern
 * containing `..` (vercel/next.js#95496). Keep new patterns `./`-relative and
 * add them here rather than globbing from a subdirectory.
 *
 * Client-visible discovery lives in `_view-globs.ts` — do not merge the two,
 * or problem configs and inline judges end up in the browser bundle.
 */

export const problemConfigModules = import.meta.glob("./problems/*/problem.ts", {
  eager: true,
});

export const problemJudgeModules = import.meta.glob("./problems/*/judge.ts", {
  eager: true,
});

export const problemStatementModules = import.meta.glob(
  "./problems/*/statement.mdx",
);

export const contestModules = import.meta.glob("./contests/*/contest.ts", {
  eager: true,
});

export const rulesetModules = import.meta.glob("./rulesets/*.tsx", {
  eager: true,
});

export const enrollmentModules = import.meta.glob("./enrollment/*.ts", {
  eager: true,
});

export const emailModules = import.meta.glob("./emails/index.ts", {
  eager: true,
});
