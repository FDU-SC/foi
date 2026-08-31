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
app/            Next.js contract surface — route shells, Server Actions, API handlers
views/          Page bodies — everything a route renders
components/     Platform UI primitives and slot components
lib/            Platform core — defines contracts (types), registries, and mechanisms
  lib/authz/          Action catalogue, policy engine, the single authorize() entry point
  lib/site.ts         Site config contract (SiteConfig type) — consumed from content
  lib/site-views.ts   Chrome slot contract (SiteViews) — consumed from content
  lib/standings/      Ruleset contract, standings computation, freeze-as-permission
  lib/problems/       Problem registry, views interface (ProblemViews)
  lib/presentation.ts Verdict translation (describeVerdict), BadgeTone/VerdictPreset types
  lib/backend/        Verdict schema ({ result, detail }), runner protocol
  lib/db/             Drizzle schema — submissions have result + detail JSONB, nothing else
content/        All contest-specific code — see content/AGENTS.md
test/           Kernel test support: fixture content, shape helpers — see test/AGENTS.md
```

`app/` holds what Next discovers from the filesystem and nothing else. A route
file declares its segment config and forwards to `views/`; a page body that
grows back into `app/` is somewhere a fork cannot override, so a guard test in
`test/slots.test.ts` fails on it. Server Actions stay in `app/` too, and for a
second reason: `lib/ratelimit/policy.test.ts` finds them by scanning that tree,
and behaviour must not sit in a layer a deployment can replace.

## Platform → Content Boundary

The platform discovers content through twelve entry points: the seven registries under `content/_modules/`, plus `content/site.ts`, `site-views.tsx`, `backends.ts`, `schema.ts` and `theme.css`. The `app/`, `views/` and `components/` layers NEVER import from `content/` directly — only `lib/` does, and only through those twelve. `test/slots.test.ts` enforces it.

Tests hold the same line. The `unit` and `db` vitest projects resolve all twelve to `test/fixtures/content/`, so a kernel test asserts what the platform does and never what a deployment happens to contain. Only the `deployment` project sees the real `content/`. A fork may delete any group, problem or contest without turning the kernel suites red.

## Slots

`content/`, `components/` and `views/` here are all samples of a kind. Each has a `.local` twin a fork fills, and `tsconfig.json` resolves the alias to that twin first, **falling back per file**:

```json
"@/content/*":    ["./content.local/*",    "./content/*"],
"@/components/*": ["./components.local/*", "./components/*"],
"@/views/*":      ["./views.local/*",      "./views/*"],
```

So a deployment overrides the handful of files it cares about and inherits the rest — the difference between a merge that conflicts every time and one that never does. `test/content-roots.mjs` is the single list of slots; no `.local` root exists in this repository, and resolution, the deployment test project and every source scanner tolerate their absence.

Depth of customization, shallowest first — **prefer the shallowest that works**, because each step down gives up more of the upstream's future changes:

1. **Data.** `content/site.ts` for brand, navigation, tagline, footer; `content/theme.css` for colour tokens, which load after `globals.css` so redeclaring one wins.
2. **Chrome slots.** `SiteViews` in `content/site-views.tsx` replaces the Header, Footer, Brand, HomeHero or AuthShell. Every slot is optional and has a platform default, so `{}` is a complete implementation.
3. **File override.** Any file under `components/` or `views/` can be replaced wholesale by a same-named file in its `.local` twin. This is how a whole page gets rewritten — and the overriding file stops tracking upstream changes to it, which is the price.

An override that wants to wrap the upstream original must reach it by **relative path** (`../../components/site/header`), because the alias would resolve back to the override itself.

New routes need no slot: a fork adds files under `app/` and nothing collides, since the upstream has no file there. Put them in the `app/(local)/` route group — a group does not affect URLs, and the upstream never places a file in it, so the two sides never contend for a path.

New tables are the same shape one layer down. Declare them in `content.local/schema.ts`; `lib/db/index.ts` merges them into the drizzle instance. Their migrations live in `drizzle.local/` with their own journal, generated by `drizzle.local.config.ts`, and `instrumentation.ts` applies that folder after `drizzle/`. Upstream and downstream version numbers never collide.

## Authorization

Permission has exactly one entry point:

```ts
authorize(action, resource, viewer, context) → Decision
```

Default-deny. A request is refused unless some `permit` policy matches, and a matching `forbid` beats every `permit`.

The split follows the same rule as everything else here:

- **The platform owns the action catalogue** (`lib/authz/actions.ts`). It has to: the enforcement points are platform code, and they name these ids literally. Adding a gate means adding an action.
- **Content owns the policies** (`content/policies/`). Who may do what is a deployment decision, and it belongs in a diff.
- **Builtin policies** (`lib/authz/builtin.ts`) do two things only: give platform-declared resource attributes their meaning (`visibleTo`, `retired`, `participants`, the contest window), and enforce invariants content must not be able to grant around. They never hand power to a principal.

A group is a label. It carries no permissions — what its members may do is whatever policies name it. "Privileged" is derived: a group some `permit` policy points at.

Refusals are one shape (`Decision`) turned into each layer's expectation by the adapters in `lib/authz/adapters.ts` and `http.ts` — `undefined` for a read gate, a thrown `ForbiddenError` for a write, a status-carrying JSON body for a route. Never invent a new way to say no.

## Key Contracts

When writing content, you implement these platform-defined interfaces:

| What you're creating | Interface to satisfy | Registered via |
|---|---|---|
| A problem | `ProblemConfigInput` | `_modules/problems.ts` (glob) |
| A contest | `ContestConfigInput` | `_modules/contests.ts` (glob) |
| A ruleset | `Ruleset<Cell>` | `_modules/rulesets.ts` (glob) |
| Problem views | `ProblemViews` | `_modules/problem-views.ts` (glob) |
| Enrollment policy | `EnrollmentPolicyInput` | `_modules/enrollment.ts` (glob) |
| Authorization policies | `policy({ ... })` from `lib/authz/types` | `_modules/policies.ts` (glob) |
| Email templates | `EmailTemplates` | `_modules/emails.ts` (glob) |
| Backend connections | `Record<string, ProblemBackend>` | `content/backends.ts` |
| Site config | `SiteConfig` | `content/site.ts` |
| Chrome slots | `SiteViews` | `content/site-views.tsx` |
| Deployment tables | drizzle table objects | `content/schema.ts` |
| Colour tokens | CSS custom properties | `content/theme.css` |

## Do NOT

- Add score/maxScore/accepted/outcome columns to the DB — those are result-shape assumptions
- Write `isAccepted()` or `verdictColumns()` in `lib/` — result interpretation is the ruleset's job
- Hardcode brand names, locale, timezone, or navigation in `app/` or `lib/` — those come from `content/site.ts`
- Put `render` or `supportsFreeze` on the `Ruleset` interface — rulesets are pure compute functions
- Assign `ruleset` directly on `ContestConfig` — leaderboards own their rulesets
- Add dual-computation for freeze — freeze is permission-based result masking, not double-compute
- Answer "may they" anywhere but `authorize()` — a hand-written `groups.includes(...)` outside `lib/authz/` fails a guard test
- Grant anything to a group from `lib/` — builtin policies interpret attributes; grants live in `content/policies/`
- Give a policy a `when` on a queryable action without a matching `filter` — the row would silently vanish from every list
- Import `content/` from a kernel test, or assert a deployment's group / contest / problem there — ask `test/content-shapes.ts` for the shape instead
- Write a page body in `app/` — route files declare and forward, page bodies live in `views/` where a fork can replace them
- Put a Server Action in `views/` or `components/` — behaviour must not sit in a layer a deployment can override, and the rate-limit guard only scans `app/`
- Re-export `@/content/schema` from `lib/db/schema.ts` — `drizzle.config.ts` reads that file, and upstream migrations must not see a fork's tables
