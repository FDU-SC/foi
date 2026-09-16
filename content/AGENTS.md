# content/ — Contest Content Layer

Everything in this directory is deployment-specific. Swapping this directory produces a different contest site. Only `lib/` imports from `content/`, and only through the entry points below; `app/`, `views/` and `components/` never do.

## Three-Layer Structure

```
content/
  _modules/       Registry entries — seven of the entry points
  _shared/        Reusable template library — composable building blocks (see _shared/AGENTS.md)
  problems/       Problem instances (one directory per problem)
  contests/       Contest instances (one directory per contest)
  rulesets/       Scoring algorithms + companion renderers
  enrollment/     Group labels, registration policy, routing rules
  policies/       Authorization policies — who may do what
  emails/         Email templates (verification, password reset, email change)
  _globs.ts       import.meta.glob discovery, server-only — must sit here, see _modules/AGENTS.md
  _view-globs.ts  import.meta.glob discovery for per-problem views (client-visible)
  backends.ts     External backend connection registry
  site.ts         Site-wide configuration (brand, locale, navigation, password policy)
  site-views.tsx  Chrome slots — Header, Footer, Brand, HomeHero, AuthShell
  schema.ts       Tables this deployment adds for itself
  theme.css       Colour tokens, loaded after globals.css
```

`site-views.tsx`, `schema.ts` and `theme.css` provide components, drizzle tables
and styles respectively. Each has a platform default; their deployment-specific
contents remain opaque to the platform.

## Creating Content

### Adding a Problem

1. Create `content/problems/<slug>/problem.ts` — export `problem` satisfying `ProblemConfigInput`
2. Create `content/problems/<slug>/statement.mdx` — the problem statement, using MDX components
3. Create `content/problems/<slug>/views.tsx` — export `views` satisfying `ProblemViews` (auto-discovered by glob)
4. The problem is automatically registered via `_modules/problems.ts` glob
5. Add it to some contest's `problems` — a problem is reachable only as part of
   a contest, so one no contest lists has no URL and the boot check reports it

The problem config says nothing about who may open it or when. Its audience is
the contest's `visibleTo`, its window is the contest's, and access after the
end is defined by the contest's `afterEnd`. The same problem may sit in several contests
and be open in one while sealed in another.

Where it answers depends on which contest you added it to: a contest
`site.catalogue` names serves its problems at `/problems/<contest>/<slug>`,
every other contest at `/contests/<contest>/problems/<slug>`. Either way it is
one address.

`ui` carries the presentation metadata — `difficulty`, `tags`, `languages`,
`placeholder`. Declare whichever apply; the platform stores it without reading
it, and whether difficulty and tags are shown at all is each contest's call.

In `statement.mdx`, import and compose the submission UI from templates:

```tsx
import { Constraints } from "@/content/_shared/mdx/constraints";
import { SubmitPanel } from "@/content/_shared/ui/submit-panel";
import { CodeInput } from "@/content/_shared/ui/code-input";

<SubmitPanel><CodeInput /></SubmitPanel>    // code submission
<SubmitPanel><FlagInput /></SubmitPanel>    // flag submission
<SubmitPanel><TextInput /></SubmitPanel>    // text submission
<SubmitPanel><MyCustomInput /></SubmitPanel> // anything custom
```

In `views.tsx`, compose display templates:

```typescript
import { CodePayloadView } from "@/content/_shared/views/code-payload";
import { VerdictDetail } from "@/content/_shared/views/tests-table";
import { describeResult, progress } from "@/content/_shared/verdicts";
import { ProblemBadges } from "@/content/_shared/ui/problem-badges";
import { problemFacets } from "@/content/_shared/ui/problem-facets";

export const views: ProblemViews = {
  PayloadView: CodePayloadView,
  VerdictDetail,
  describeResult,
  progress,
  Badges: ProblemBadges,
  facets: problemFacets,
};
```

`facets` is what turns `ui` fields into dimensions a contest can filter by.
`problemFacets` maps `difficulty` and `tags` onto two of them; the platform
matches the values as strings and never learns what a key means. Without it, the problem has no facets: facet filters do not exclude it, and it shows no badges.

`describeResult(result: unknown)` returns a `VerdictPreset`. It owns all result
field access, including unknown-status fallback. Without it the platform shows
“已评测” with a neutral tone.

`progress(history)` returns `{ state, verdict }`, where `state` is `untouched`,
`attempted` or `solved` and `verdict` is a preset or null. The history contains
`id`, record `state`, opaque `result`, `createdAt` and `judgedAt`, ordered by
creation time and id. It includes every readable submission by the current user
for this contest/problem pair, including pending and disrupted records.
The content function decides which records count. The sample requires a
completed record with boolean `accepted: true` and keeps any previous success.

Both functions are pure and client-safe: the problem views registry is used in
the browser. Keep database imports in server-only content modules. Without
`progress`, the problem has no progress display; section filters and totals
require every visible problem to support it.

### Adding a Contest

Create `content/contests/<slug>/contest.ts` — export `contest` satisfying `ContestConfigInput`.

A contest owns its leaderboards. Each leaderboard references a ruleset:

```typescript
export const contest = {
  slug: "my-contest",
  title: "...",
  leaderboards: [
    { id: "main", title: "排行榜", ruleset: { id: "acm", config: { penaltyMinutes: 20 } } },
  ],
  problems: [{ slug: "problem-a", label: "A" }],
  // ...
} satisfies ContestConfigInput;
```

`label` is the contest letter a round numbers its problems with. A catalogue
section omits it: the index and the section list treat the array tail as the
newest problem, and a new one is appended.

`problems` determines which problems are reachable; `afterEnd` determines access after the contest ends:

```typescript
afterEnd: { statements: true, submissions: false }  // the default: readable, closed
afterEnd: { statements: true, submissions: true }   // still collecting, outside every board's window
afterEnd: { statements: false }                     // sealed; the round takes its problems with it
```

A practice area is a contest whose window is long. Taking a problem out of
circulation is removing it from `problems`.

`facets` names which of a problem's dimensions this contest's pages offer, as
both filter chips and badges:

```typescript
facets: ["difficulty", "tags"],   // the keys `problemFacets` hands back
```

The default is empty: neither filters nor badges reveal difficulty or tags.
Catalogue sections declare the dimensions they offer. Index cards show only
dimensions without an `order`; ordered dimensions appear as filters and badges
on the section page.

### Mounting Contests as the Catalogue

`site.catalogue` in `content/site.ts` names contests, and each answers at
`/problems/<slug>` instead of `/contests/<slug>` — its problems at
`/problems/<slug>/<problem>`, its leaderboard at `/problems/<slug>/standings`,
and it drops out of the `/contests` list. Everything else about it is
unchanged: the window, the `participants`, the `visibleTo`, and the fact that
its submissions carry its slug.

```typescript
catalogue: [
  "puzzles",
  "kernel",
  "comm",
  "framework",
  "inference",
  "cluster",
  "graphs",
  "dynamic-programming",
  "data-structures",
  "divide-and-conquer",
  "ctf",
  "pwn",
  "reverse",
  "crypto",
  "misc",
],
```

`/problems` is the index those cards sit on, grouped by each contest's `domain`:

```typescript
domain: "HPC & AI Infra",
```

Headings appear in the order their first contest appears in `catalogue`, and a
contest without one lands in an unlabelled group at the end. A heading is a
heading, not a page — there is no `/problems/<domain>`.

The boot check refuses a catalogued contest carrying a problem named
`standings`: the leaderboard page shadows it, so it would have no address at
all. A slug no contest matches is a warning instead — that card is missing and
its own addresses answer 404, while the rest of the site is unaffected. Omit
the field and every contest stays under `/contests`.

### Adding a Ruleset

Create `content/rulesets/<id>.tsx` — export `ruleset` satisfying `Ruleset<Cell>`.

A ruleset is a **pure function**: it receives submissions and outputs rankings. It does NOT know about freeze, rendering, or leaderboard structure.

Export companion renderers separately (not on the Ruleset interface):

```typescript
export const ruleset: Ruleset<MyCell> = {
  id: "my-ruleset",
  name: "My Ruleset",
  description: "...",
  compute(input) { /* return { rows, totalLabel } */ },
};

// Companion renderers — exported separately, used by leaderboard templates
export const renderers: RulesetRenderers = { Cell: MyCellView, Total: MyTotalView };
export function MyCellView({ cell }: { cell: MyCell | undefined }) { /* ... */ }
export function MyTotalView({ row }: { row: StandingsRow<MyCell> }) { /* ... */ }
```

### Inline Judges

For problems judged synchronously (no external backend), return `{ result, detail }`:

```typescript
judge({ payload, config, user }) {
  // result: whatever fields your ruleset reads (e.g., accepted, score, maxScore)
  // detail: whatever your VerdictDetail component renders
  return {
    result: { status: "accepted", score: 100, maxScore: 100, accepted: true },
    detail: { cases: [{ name: "Case 1", correct: true }] },
  };
}
```

The `result` may be any non-null JSON value. Its meaning is your decision. The platform stores it as opaque JSONB. Your ruleset interprets it; your VerdictDetail renders the detail.

## Practice Leaderboard

`SiteViews.Leaderboard` supplies the full leaderboard; `HomeLeaderboard` supplies
the home summary. The platform checks `leaderboard.read` before mounting either.
An absent full leaderboard returns 404. Content owns querying, ranking and display.
The sample shares a server-only query between both slots; its rules are documented
in [the migration guide](../docs/result-interpretation-migration.md).

### Adding an Authorization Policy

Create or edit a file under `content/policies/` and export `policies`:

```typescript
import { policy } from "@/lib/authz/types";

export const policies = [
  policy({
    id: "staff:submissions",
    effect: "permit",
    describe: "查看任何人的提交，并把已终结的提交放回评测队列",
    action: ["submission.read", "submission.rejudge"],
    principal: { group: "管理员" },
  }),
];
```

The platform default-denies, so a permit is what grants. A `forbid` beats every permit — use it for rules nothing should override.

- `action` names ids from `lib/authz/actions.ts`. Content does not invent actions; if a gate is missing, the platform needs a new one.
- `principal` is data, not a function (`{ group }` / `{ anyGroup }` / `{ authenticated: true }` / `{ self: true }`, or omitted for everyone). That is what lets the platform derive which groups are privileged and render the policy matrix at `/admin`.
- `when` is an arbitrary predicate over `{ viewer, resource, now, contest, invocation }`. On a *queryable* action it must be paired with a `filter` that says the same thing in SQL — list endpoints ask the database, not each row.
- `describe` is shown wherever the policy set is listed, so write it for whoever inherits this deployment.

A group named by a permit becomes privileged, which means `content/enrollment/` may only hand it out by uid, never by an email pattern.

## Site Configuration

`content/site.ts` defines deployment-wide settings: brand name, language, timezone, navigation, tagline, footer, password policy. The platform reads these—it never hardcodes them.

Navigation entries gate on the same action their destination enforces:

```typescript
{ href: "/admin", label: "管理", visibleWhen: "admin.enter" }
```

## Changing How a Page Looks

Prefer the shallowest customization: wording and links in `site.ts`, colours
in `theme.css`, then chrome slots or file overrides for structural changes.

A region whose *structure* differs is a slot in `content/site-views.tsx`:

```tsx
import type { SiteViews } from "@/lib/site-views";
export const views: SiteViews = { Footer: MyFooter };
```

Every slot is optional, so `{}` is complete. Chrome slots have defaults; optional content regions may be absent, and an absent `Leaderboard` returns 404. Regions outside the override continue to receive upstream updates.

A page whose whole body needs rewriting is a file override: put a same-named file under `views.local/` and it replaces the upstream one. That file no longer receives upstream changes automatically; use this option only when shallower overrides are insufficient. See [the README](../README.md#派生一份自己的部署) for the slot map.
