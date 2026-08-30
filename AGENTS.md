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
  lib/authz/          Action catalogue, policy engine, the single authorize() entry point
  lib/site.ts         Site config contract (SiteConfig type) — consumed from content
  lib/standings/      Ruleset contract, standings computation, freeze-as-permission
  lib/problems/       Problem registry, views interface (ProblemViews)
  lib/presentation.ts Verdict translation (describeVerdict), BadgeTone/VerdictPreset types
  lib/backend/        Verdict schema ({ result, detail }), runner protocol
  lib/db/             Drizzle schema — submissions have result + detail JSONB, nothing else
content/        All contest-specific code — see content/AGENTS.md
test/           Kernel test support: fixture content, shape helpers — see test/AGENTS.md
```

## Platform → Content Boundary

The platform discovers content through nine entry points: the seven registries under `content/_modules/`, plus `content/site.ts` and `content/backends.ts`. The `app/` and `components/` layers NEVER import from `content/` directly — only `lib/` does, and only through those nine.

Tests hold the same line. The `unit` and `db` vitest projects resolve all nine to `test/fixtures/content/`, so a kernel test asserts what the platform does and never what a deployment happens to contain. Only the `deployment` project (`content/**/*.test.ts`) sees the real `content/`. A fork may delete any group, problem or contest without turning the kernel suites red.

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
