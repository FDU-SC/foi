# _modules/ — Registry Entries

This directory is the **only interface** between the platform (`lib/`) and content. The platform never imports from `content/` except through these files.

Each file here re-exports one slice of content discovery. The platform's registries in `lib/` import from here and validate the shape.

The `import.meta.glob` calls themselves live one level up, in `content/_globs.ts` (server-only) and `content/_view-globs.ts` (client-visible), because glob patterns may only descend — see Conventions.

## Current Registries

| File | Discovery | What it provides | Platform consumer |
|---|---|---|---|
| `problems.ts` | glob `./problems/*/problem.ts` | Problem configs + statement MDX | `lib/problems/registry.ts` |
| `problem-views.ts` | glob `./problems/*/views.tsx` | Per-problem PayloadView / VerdictDetail / verdicts | `lib/problems/views.ts` |
| `contests.ts` | glob `./contests/*/contest.ts` | Contest configs | `lib/contests/registry.ts` |
| `rulesets.ts` | glob `./rulesets/*.tsx` | Ruleset compute functions + renderers | `lib/standings/registry.ts` |
| `backends.ts` | re-export `../backends` | External backend connections | `lib/backend/registry.ts` |
| `enrollment.ts` | glob `./enrollment/*.ts` | Groups, policies, routing rules | `lib/enrollment/modules.ts` |
| `emails.ts` | glob `./emails/index.ts` | Email templates | `lib/mail/registry.ts` |
| `site.ts` | re-export `../site` | Site config (brand, locale, navigation) | `lib/site.ts` |

Glob patterns are shown relative to the content root, which is where they are written.

## Conventions

- **Glob patterns may only descend.** Turbopack silently returns `{}` for any pattern containing `..` — no error, no warning, `next build` still succeeds ([vercel/next.js#95496](https://github.com/vercel/next.js/issues/95496)). Vite handles `..` fine, so such a pattern passes the whole test suite and discovers nothing in the real app. This is why all globs live at the content root; add new ones to `_globs.ts` instead of globbing from a subdirectory
- `_globs.ts` is `server-only`; `_view-globs.ts` is not. Keep them separate — merging them puts problem configs and inline judges in the browser bundle
- Files re-exporting from `_globs.ts` are marked `server-only` (except `problem-views.ts`, which needs client-side rendering)
- Parse slugs by anchoring on the directory name (`/problems\/([^/]+)\//`), never on a leading `./`, so key formatting stays a bundler detail
- Glob-discovered modules must export a specific named constant (`problem`, `contest`, `ruleset`, `views`, etc.)
- The slug/id must match the directory or file name (enforced by the platform registry)
- Validation errors throw at boot time, not at request time

## Adding a New Registry

If you need a new category of content:

1. Create the content files (e.g., `content/widgets/foo.ts`)
2. Add `import.meta.glob("./widgets/*.ts", { eager: true })` to `content/_globs.ts`
3. Create `content/_modules/widgets.ts` re-exporting it
4. Create `lib/widgets/registry.ts` that imports from `@/content/_modules/widgets`
5. Define the contract type in `lib/widgets/types.ts`
