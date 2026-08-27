<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Architecture: "Everything as Code" Contest Platform

The platform is a generic, semantics-free engine. It stores, routes, and renders—but never interprets—contest-specific data. All meaning lives in `content/`.

## The One Rule

**The platform stores but does not interpret.** These fields are `unknown` / opaque JSONB by design:

- `payload` — what the user submits (code, flag, text, file URL, anything)
- `result` — evaluation outcome from the judge/backend (score, accepted, executionTime, anything)
- `detail` — display data for the submission detail page (test cases, compiler errors, anything)
- `problem.ui` — problem metadata for presentation (difficulty, tags, anything)
- `problem.backend.config` — backend-specific configuration (time limits, Docker image, anything)
- `ruleset.config` — ruleset-specific parameters (penalty minutes, decay rate, anything)

If you find yourself adding a platform-level `if` that checks the shape of any of these fields, you are violating the architecture. The interpretation belongs in `content/`.

## Directory Structure

```
app/            Next.js routes — consumes lib/ and components/, never imports content/
components/     Platform UI primitives and slot components — never imports content/
lib/            Platform core — defines contracts (types), registries, and mechanisms
  lib/site.ts         Site config contract (SiteConfig type) — consumed from content
  lib/standings/      Ruleset contract, standings computation, freeze-as-permission
  lib/problems/       Problem registry, views interface (ProblemViews)
  lib/presentation.ts Verdict translation (describeVerdict), BadgeTone/VerdictPreset types
  lib/backend/        Verdict schema ({ result, detail }), runner protocol
  lib/db/             Drizzle schema — submissions have result + detail JSONB, nothing else
content/        All contest-specific code — see content/AGENTS.md
```

## Platform → Content Boundary

The platform discovers content exclusively through `content/_modules/` (currently 8 registries). The `app/` and `components/` layers NEVER import from `content/` directly. Only `lib/` imports from `content/_modules/`.

## Key Contracts

When writing content, you implement these platform-defined interfaces:

| What you're creating | Interface to satisfy | Registered via |
|---|---|---|
| A problem | `ProblemConfigInput` | `_modules/problems.ts` (glob) |
| A contest | `ContestConfigInput` | `_modules/contests.ts` (glob) |
| A ruleset | `Ruleset<Cell>` | `_modules/rulesets.ts` (glob) |
| Problem views | `ProblemViews` | `_modules/problem-views.ts` (glob) |
| Enrollment policy | `EnrollmentPolicyInput` | `_modules/enrollment.ts` (glob) |
| Email templates | `EmailTemplates` | `_modules/emails.ts` (glob) |
| Backend connections | `Record<string, ProblemBackend>` | `_modules/backends.ts` |
| Site config | `SiteConfig` | `_modules/site.ts` |

## Do NOT

- Add score/maxScore/accepted/outcome columns to the DB — those are result-shape assumptions
- Write `isAccepted()` or `verdictColumns()` in `lib/` — result interpretation is the ruleset's job
- Hardcode brand names, locale, timezone, or navigation in `app/` or `lib/` — those come from `content/site.ts`
- Put `render` or `supportsFreeze` on the `Ruleset` interface — rulesets are pure compute functions
- Assign `ruleset` directly on `ContestConfig` — leaderboards own their rulesets
- Add dual-computation for freeze — freeze is permission-based result masking, not double-compute
