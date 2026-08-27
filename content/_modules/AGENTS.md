# _modules/ — Registry Entries

This directory is the **only interface** between the platform (`lib/`) and content. The platform never imports from `content/` except through these files.

Each file here either uses `import.meta.glob` to auto-discover content, or re-exports a singleton module. The platform's registries in `lib/` import from here and validate the shape.

## Current Registries

| File | Discovery | What it provides | Platform consumer |
|---|---|---|---|
| `problems.ts` | glob `../problems/*/problem.ts` | Problem configs + statement MDX | `lib/problems/registry.ts` |
| `problem-views.ts` | glob `../problems/*/views.tsx` | Per-problem PayloadView / VerdictDetail / verdicts | `lib/problems/views.ts` |
| `contests.ts` | glob `../contests/*/contest.ts` | Contest configs | `lib/contests/registry.ts` |
| `rulesets.ts` | glob `../rulesets/*.tsx` | Ruleset compute functions + renderers | `lib/standings/registry.ts` |
| `backends.ts` | re-export `../backends` | External backend connections | `lib/backend/registry.ts` |
| `enrollment.ts` | glob `../enrollment/*.ts` | Groups, policies, routing rules | `lib/enrollment/modules.ts` |
| `emails.ts` | glob `../emails/index.ts` | Email templates | `lib/mail/registry.ts` |
| `presentation.ts` | re-export `../_shared/presentation` | MDX components, verdicts, ProblemBadges | `lib/presentation.ts` |
| `site.ts` | re-export `../site` | Site config (brand, locale, navigation) | `lib/site.ts` |

## Conventions

- Files using `import.meta.glob` are marked `server-only` (except `problem-views.ts` and `presentation.ts`, which need client-side rendering)
- Glob-discovered modules must export a specific named constant (`problem`, `contest`, `ruleset`, `views`, etc.)
- The slug/id must match the directory or file name (enforced by the platform registry)
- Validation errors throw at boot time, not at request time

## Adding a New Registry

If you need a new category of content:

1. Create the content files (e.g., `content/widgets/foo.ts`)
2. Create `content/_modules/widgets.ts` with `import.meta.glob` or re-export
3. Create `lib/widgets/registry.ts` that imports from `@/content/_modules/widgets`
4. Define the contract type in `lib/widgets/types.ts`
