# _modules/ — Registry Entries

This directory, plus `content/site.ts`, `site-views.tsx`, `backends.ts`, `schema.ts` and `theme.css`, is the **only interface** between the platform (`lib/`) and content. The platform must not import other `content/` paths.

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

The remaining five entry points need no discovery, so they have no file here — each is a single declared file the platform imports directly:

| File | Platform consumer | What it declares |
|---|---|---|
| `site.ts` | `lib/site.ts` | Brand, locale, navigation, footer |
| `site-views.tsx` | `lib/site-views.ts` | Chrome slots (`SiteViews`) |
| `backends.ts` | `lib/backend/registry.ts` | External backend connections |
| `schema.ts` | `lib/db/index.ts` | Tables this deployment adds |
| `theme.css` | `lib/theme.ts` | Colour tokens |

`schema.ts` reaches the drizzle instance through `lib/db/index.ts`, not through `lib/db/schema.ts` — `drizzle.config.ts` reads that file, and upstream migrations must not pick up a deployment's tables.

## Conventions

- **Glob patterns may only descend.** Add server-side globs to `_globs.ts` at the content root. Turbopack silently returns `{}` for patterns containing `..`, even when builds and Vite tests pass ([vercel/next.js#95496](https://github.com/vercel/next.js/issues/95496))
- `_globs.ts` is `server-only`; `_view-globs.ts` is not. Keep them separate — merging them puts problem configs and inline judges in the browser bundle
- Files re-exporting from `_globs.ts` are marked `server-only` (except `problem-views.ts`, which needs client-side rendering)
- Parse slugs by anchoring on the directory name (`/problems\/([^/]+)\//`), never on a leading `./`, so key formatting stays a bundler detail
- Glob-discovered modules must export a specific named constant (`problem`, `contest`, `ruleset`, `views`, `policies`, etc.)
- The slug/id must match the directory or file name (enforced by the platform registry)
- Validation errors must throw at boot. The policy registry builds lazily to avoid an engine dependency cycle; `lib/boot/checks.ts` forces its first build during boot

## Adding a New Registry

If you need a new category of content:

1. Create the content files (e.g., `content/widgets/foo.ts`)
2. Add `import.meta.glob("./widgets/*.ts", { eager: true })` to `content/_globs.ts`
3. Create `content/_modules/widgets.ts` re-exporting it
4. Create `lib/widgets/registry.ts` that imports from `@/content/_modules/widgets`
5. Define the contract type in `lib/widgets/types.ts`

Step 4 declares the entry point. `scripts/strip-content.ts` reads the
`@/content/...` imports under `lib/` to determine what the content-free CI job
keeps. No separate entry-point list needs updating.
