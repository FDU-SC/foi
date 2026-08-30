# _modules/ — Registry Entries

This directory, plus `content/site.ts` and `content/backends.ts`, is the **only interface** between the platform (`lib/`) and content. Those nine entry points are the whole surface; the platform never imports from `content/` anywhere else.

Each file here re-exports one slice of content discovery. The platform's registries in `lib/` import from here and validate the shape.

The `import.meta.glob` calls themselves live one level up, in `content/_globs.ts` (server-only) and `content/_view-globs.ts` (client-visible), because glob patterns may only descend — see Conventions.

## Current Registries

| File | Discovery | What it provides | Platform consumer |
|---|---|---|---|
| `problems.ts` | glob `./problems/*/problem.ts` | Problem configs + statement MDX | `lib/problems/registry.ts` |
| `problem-views.ts` | glob `./problems/*/views.tsx` | Per-problem PayloadView / VerdictDetail / verdicts | `lib/problems/views.ts` |
| `contests.ts` | glob `./contests/*/contest.ts` | Contest configs | `lib/contests/registry.ts` |
| `rulesets.ts` | glob `./rulesets/*.tsx` | Ruleset compute functions + renderers | `lib/standings/registry.ts` |
| `enrollment.ts` | glob `./enrollment/*.ts` | Group labels, registration policy, routing rules | `lib/enrollment/modules.ts` |
| `policies.ts` | glob `./policies/*.ts` | Authorization policies (permit / forbid) | `lib/authz/registry.ts` |
| `emails.ts` | glob `./emails/index.ts` | Email templates | `lib/mail/registry.ts` |

Glob patterns are shown relative to the content root, which is where they are written.

The remaining two entry points need no discovery, so they have no file here: `lib/site.ts` imports `@/content/site` and `lib/backend/registry.ts` imports `@/content/backends`, each a single declared object.

## Conventions

- **Glob patterns may only descend.** Turbopack silently returns `{}` for any pattern containing `..` — no error, no warning, `next build` still succeeds ([vercel/next.js#95496](https://github.com/vercel/next.js/issues/95496)). Vite handles `..` fine, so such a pattern passes the whole test suite and discovers nothing in the real app. This is why all globs live at the content root; add new ones to `_globs.ts` instead of globbing from a subdirectory
- `_globs.ts` is `server-only`; `_view-globs.ts` is not. Keep them separate — merging them puts problem configs and inline judges in the browser bundle
- Files re-exporting from `_globs.ts` are marked `server-only` (except `problem-views.ts`, which needs client-side rendering)
- Parse slugs by anchoring on the directory name (`/problems\/([^/]+)\//`), never on a leading `./`, so key formatting stays a bundler detail
- Glob-discovered modules must export a specific named constant (`problem`, `contest`, `ruleset`, `views`, `policies`, etc.)
- The slug/id must match the directory or file name (enforced by the platform registry)
- Validation errors throw at boot time, not at request time. The policy registry is the one exception to *when* that happens: it builds on first use, because the builtin policies call back into the engine that reads it. `lib/boot/checks.ts` forces the build during boot, so the timing stays the same from the outside

## Adding a New Registry

If you need a new category of content:

1. Create the content files (e.g., `content/widgets/foo.ts`)
2. Add `import.meta.glob("./widgets/*.ts", { eager: true })` to `content/_globs.ts`
3. Create `content/_modules/widgets.ts` re-exporting it
4. Create `lib/widgets/registry.ts` that imports from `@/content/_modules/widgets`
5. Define the contract type in `lib/widgets/types.ts`
