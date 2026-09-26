# standings/ — Rulesets, Leaderboards, and Freeze

## Ruleset Contract

A `Ruleset<Cell>` is a **pure function**. It receives submissions and outputs rankings.

```typescript
interface Ruleset<Cell> {
  id: string;
  name: string;
  description: string;
  compute(input: StandingsInput): ComputedStandings<Cell>;
}
```

A ruleset does NOT:
- Know about freeze (封榜) — freeze is permission-based result masking handled by `compute.ts`
- Know about rendering — companion renderers are exported separately from the ruleset file, not on the interface
- Know about leaderboard structure — that's the contest's and the template's concern

`Cell` is the per-problem data shape defined by the ruleset (e.g., `AcmCell`, `OiCell`). The platform uses `AnyRuleset = Ruleset<any>` for the heterogeneous registry.

## Companion Renderers

Renderers understand the `Cell` shape, so they naturally live in the same file as the ruleset. But they are **separate exports**, not part of the `Ruleset` interface:

```typescript
// content/rulesets/acm.tsx
export const ruleset: Ruleset<AcmCell> = { id: "acm", compute(input) { ... } };
export const renderers: RulesetRenderers = { Cell: AcmCellView, Total: AcmTotalView };
```

The registry (`registry.ts`) collects both `ruleset` and `renderers` from each module.

## Leaderboard Ownership

Leaderboards are a **contest property**, not a ruleset property. Each leaderboard in a contest's `leaderboards[]` references a ruleset by id:

```typescript
leaderboards: [
  { id: "main", title: "排行榜", ruleset: { id: "acm", config: { penaltyMinutes: 20 } } },
]
```

Different leaderboards in the same contest can use different rulesets.

## One Input, One Or Many Contests

`StandingsInput` spans every contest a board reads:

```typescript
interface StandingsInput {
  config: unknown;
  contests: ContestWindow[];      // each with its own startsAt..endsAt
  problems: ContestProblem[];     // key = pairKey(contestSlug, slug)
  participants: Participant[];
  submissions: SubmissionRecord[]; // contestSlug + problemKey
}
```

- Key cells by `problem.key` and match submissions by `problemKey`. The same problem may sit in two contests of one board, so a slug alone is ambiguous.
- Measure time with `elapsed(input, submission)`, which starts at the submission's own contest.

Two entry points in `compute.ts` build that input:

- `standingsFor(slug, viewer)` — every leaderboard one contest declares.
- `catalogueStandingsFor({ board, sections, days }, viewer)` — a catalogue board: the main leaderboards (`leaderboards[0]`) of the sections it spans, computed as one.
  - `sections` narrows to some of them; `days` keeps only recent submissions.
  - A section counts only where the viewer may read its standings and problem set.
  - `lib/contests/warnings.ts` refuses to boot when a board's sections differ in ruleset or configuration.

Both share one cache. Each entry is tagged with the contests it read, so `invalidateStandings(slug)` also clears every catalogue board that includes that contest.

## Displaying a Board

`components/standings/standings-panel.tsx` wraps any computed board with the viewer's own place, a name search, the page's filters and pagination. Search and paging run after ranking, so a row keeps its place on the whole board. The board itself is the ruleset's `Board` renderer, which receives the viewer's uid as `highlight`.

## Freeze as Permission

Freeze is NOT "compute twice and diff." It is permission-based result masking:

1. `standingsFor(slug, viewer)` asks `authorize("standings.readUnfrozen", contest, viewer)` — one authorization question like any other
2. If it is refused and the contest is in frozen phase, submissions after `freezeAt` have their `result` set to `null`
3. The ruleset's `compute()` receives these masked submissions and naturally treats `result: null` as "pending" (via `hasResult()`)
4. Only one computation happens per cache key

## Result Interpretation

The platform does NOT interpret `submission.result`. Rulesets define their own expected shape:

```typescript
// ACM reads: { accepted: boolean }
// OI reads: { score: number, maxScore: number }
// Custom reads: anything
```

Utility functions available to rulesets:
- `submissionsInWindow(input)` — keep each submission inside its own contest's time range, exclude disrupted
- `elapsed(input, submission)` — milliseconds since the submission's contest started
- `hasResult(submission)` — true when state is "completed" and result is non-null
- `assignRanks(rows)` — sort by total desc / tiebreak asc, assign tied ranks

## Scoring the Window Is the Ruleset's Job

`compute.ts` passes every submission attributed to the board's contests,
including those accepted after a contest ends via `afterEnd.submissions`.
Rulesets must use `submissionsInWindow` to restrict scoring to each contest's
`startsAt`..`endsAt`; late practice submissions must not affect official rankings.

`lib/standings/window.test.ts` checks this contract for the kernel;
`content/deployment.test.ts` checks registered deployment rulesets.
