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
- `submissionsInWindow(input)` — filter to contest time range, exclude disrupted
- `hasResult(submission)` — true when state is "completed" and result is non-null
- `assignRanks(rows)` — sort by total desc / tiebreak asc, assign tied ranks

## Scoring the Window Is the Ruleset's Job

A contest whose `afterEnd.submissions` is true keeps collecting once its clock
runs out, and `compute.ts` hands the ruleset **every** submission attributed to
the round, late ones included. It does not clamp: a ruleset owns what counts,
and the platform does not decide that for it.

So a leaderboard covers `startsAt`..`endsAt` only because the ruleset runs its
submissions through `submissionsInWindow`. Skip it and late practice work lands
on the official ranking. Two tests hold the line — `lib/standings/window.test.ts`
for the kernel, and `content/deployment.test.ts` for whatever a deployment
registers — so a new ruleset that forgets fails immediately rather than
quietly rewriting a finished contest's result.
