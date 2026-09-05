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
  lib/contests/       Contest registry, the (contest, problem) pairs every URL is built on
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

Those imports *are* the list. `scripts/strip-content.ts` derives from them what the content-free CI job keeps, following relative imports onward so the discovery files come along; adding an entry point needs no edit anywhere else.

Tests hold the same line. The `unit` and `db` vitest projects resolve all twelve to `test/fixtures/content/`, so a kernel test asserts what the platform does and never what a deployment happens to contain. Only the `deployment` project sees a deployment's own content — `content/` plus whatever a fork put in the slots. A fork may delete any group, problem or contest without turning the kernel suites red.

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
- **Builtin policies** (`lib/authz/builtin.ts`) do two things only: give platform-declared resource attributes their meaning (`visibleTo`, `participants`, the contest window and what `afterEnd` leaves of it), and enforce invariants content must not be able to grant around. They never hand power to a principal.

A group is a label. It carries no permissions — what its members may do is whatever policies name it. "Privileged" is derived: a group some `permit` policy points at.

Refusals are one shape (`Decision`) turned into each layer's expectation by the adapters in `lib/authz/adapters.ts` and `http.ts` — `undefined` for a read gate, a thrown `ForbiddenError` for a write, a status-carrying JSON body for a route. Never invent a new way to say no.

## A Problem Is a Belonging of a Contest

A problem has exactly one URL, and it is not addressable without the contest it is being worked on as part of. The resource behind `problem.read`, `problem.submit` and `problem.invoke` is the pair, not the problem:

```ts
interface ContestProblemRef { contest: ContestConfig; entry: ContestProblemConfig; problem: ProblemConfig }
```

Attribution is therefore structural rather than claimed. There is nothing to cross-check and no `context.contest`. `lib/contests/refs.ts` is where the pairs come from; a problem no contest lists has no URL, and a boot check says so.

A problem config carries no visibility of its own. Who may open it is `contest.visibleTo`, when is the contest window, and what survives `endsAt` is the contest's `afterEnd`:

| `afterEnd` | Statements | Submissions |
|---|---|---|
| omitted | readable | closed |
| `{ submissions: true }` | readable | open, and outside every leaderboard's window |
| `{ statements: false }` | sealed | closed |

Retiring a problem is removing it from `contest.problems`.

### The Catalogue Is A Set Of Those Contests

`site.catalogue` names the contests presented as a catalogue, and their pages move rather than multiply:

| | Catalogued | Every other contest |
|---|---|---|
| Index | `/problems` | `/contests` |
| Contest | `/problems/[section]` | `/contests/[slug]` |
| Problem | `/problems/[section]/[problem]` | `/contests/[slug]/problems/[problem]` |
| Standings | `/problems/[section]/standings` | `/contests/[slug]/standings` |

`[section]` is the contest slug, so each catalogued contest is one card on `/problems` — with its own window, audience, leaderboard and participants. Long-running practice is a contest whose window is long; mounting it here is what makes it read as a section instead of a round. Nothing about authorization or submission changes, and a submission still carries its slug in `contest_slug`. The API is untouched too: `/api/contests/[slug]/problems/[problem]/action/[action]` serves both.

`contest.domain` is the heading a card sits under on that index. A label the platform groups by and never interprets; headings appear in the order their first contest appears in `site.catalogue`, so the order is declared once. A domain is a heading, not a page — there is no `/problems/[domain]`.

`lib/contests/catalogue.ts` builds every such link and is the only place that reads `site.catalogue`. Never write a contest or problem path by hand — `problemHref`, `contestHref` and `standingsHref` are what keep the two namespaces from both claiming a pair.

The old addresses are closed rather than left unused. `/contests/[slug]/problems/[problem]` drops the catalogued pairs from `generateStaticParams`, and `proxy.ts` redirects everything under a catalogued `/contests` prefix. The contest slug survives into the new path, so that mapping is lossless. The proxy is where it has to happen: a page body cannot answer until its layout has streamed, which turns a redirect into a 200 carrying a meta refresh. For the same reason `catalogue.ts` reads nothing but the site config — the proxy imports it, and a contest registry does not belong in that bundle.

Naming a catalogue is optional. Omit it and every contest stays under `/contests`.

### A Contest Decides Which Dimensions It Offers

Difficulty, tags and anything like them live in `problem.ui`, which the platform does not read. What makes them filterable is `ProblemViews.facets`: content hands back `{ key, label, values, order }` and the platform collects the values, matches the strings and counts them, without learning what a key means.

`contest.facets` names which of those keys that contest's pages offer. It drives the filter bar and the problem badges together, so a dimension cannot be hidden from one and left showing on the other. The default is empty — a round that says nothing gives away nothing.

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

## Copywriting

### Pages

User-facing copy lives in `content/`, `views/`, `components/` and Server Actions in `app/`. Follow these principles when writing or reviewing it.

1. **Write for the reader, not the author.** Admin pages address operators; contestant pages address contestants. A piece of copy includes only what its reader needs to act on.
2. **No code paths in the UI.** File paths, config keys and script names belong in source comments and documentation, not on screen. Users cannot open a repository path from the browser.
3. **State the outcome, not the mechanism.** Describe what the user sees or can do, not how the system arrives there internally.
4. **No how-to guides in the interface.** Step-by-step instructions for repository operations belong in documentation files, not in page descriptions or empty states.
5. **Empty states describe the current situation.** They do not teach the reader what to do next—especially when the next step requires repository access that most readers lack.
6. **Replace system jargon with user language.** If a term appears only in source code, it does not appear in the UI. Use the word the reader would use.
7. **Keep it short.** One sentence that can be scanned is better than a paragraph that must be read. Admin descriptions in particular should be minimal—operators come to check data, not to read prose.

### Operator stdout

The platform process writes through `lib/log.ts`. Scripts are a separate dialect and do not use that module.

- One sentence: name the subject (env var, slug, id) and state the fact.
- A refuse-to-start may append a single command when that is the fix (`openssl rand -hex 32`).
- No consequence lecture, no multi-step how-to, no repository path as an instruction.
- Chinese; env vars, commands and proper nouns stay as written.
- The platform process prefixes `[foi]`; scripts do not.

## Do NOT

- Add score/maxScore/accepted/outcome columns to the DB — those are result-shape assumptions
- Give `ProblemConfig` a visibility, lifecycle or ordering field — a problem is reachable only through a contest, so the contest owns all three
- Ask about a problem without a contest — `problem.*` takes a `ContestProblemRef`, and a submission's `contest_slug` is `NOT NULL`
- Write a contest, problem or standings path by hand — `lib/contests/catalogue.ts` decides which of the two namespaces a contest answers in
- Read a field off `problem.ui` from `lib/`, `views/` or `components/` — a dimension reaches the platform as a `ProblemFacet`, and a contest decides whether it is offered at all
- Write `isAccepted()` or `verdictColumns()` in `lib/` — result interpretation is the ruleset's job
- Hardcode brand names, locale, timezone, navigation or taglines anywhere in the platform — those come from `content/site.ts`
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
