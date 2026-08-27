# content/ — Contest Content Layer

Everything in this directory is deployment-specific. Swapping this directory produces a different contest site. The platform (`app/`, `lib/`, `components/`) never imports from `content/` directly—only through `content/_modules/`.

## Three-Layer Structure

```
content/
  _modules/       Registry entries — the ONLY interface between platform and content
  _shared/        Reusable template library — composable building blocks (see _shared/AGENTS.md)
  problems/       Problem instances (one directory per problem)
  contests/       Contest instances (one directory per contest)
  rulesets/       Scoring algorithms + companion renderers
  enrollment/     Groups, enrollment policies, routing rules
  emails/         Email templates (verification, password reset, email change)
  backends.ts     External backend connection registry
  site.ts         Site-wide configuration (brand, locale, navigation, password policy)
```

## Creating Content

### Adding a Problem

1. Create `content/problems/<slug>/problem.ts` — export `problem` satisfying `ProblemConfigInput`
2. Create `content/problems/<slug>/statement.mdx` — the problem statement, using MDX components
3. Create `content/problems/<slug>/views.tsx` — export `views` satisfying `ProblemViews` (auto-discovered by glob)
4. The problem is automatically registered via `_modules/problems.ts` glob

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
import { verdicts } from "@/content/_shared/verdicts";
import { ProblemBadges } from "@/content/_shared/ui/problem-badges";
export const views: ProblemViews = { PayloadView: CodePayloadView, VerdictDetail, verdicts, Badges: ProblemBadges };
```

For custom verdict labels, override the `verdicts` field:

```typescript
export const views: ProblemViews = {
  PayloadView: CodePayloadView,
  VerdictDetail,
  verdicts: {
    ...standardVerdicts,
    optimal: { label: "最优解", short: "OPT", tone: "ok" },
  },
  Badges: ProblemBadges,
};
```

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

The `result` object shape is your decision. The platform stores it as opaque JSONB. Your ruleset interprets it; your VerdictDetail renders the detail.

## Verdict Translation

`result.status` (by convention) is mapped to human-readable labels. Lookup order:

1. Problem-level `verdicts` in `views.tsx`
2. Fallback: display raw status string

## Site Configuration

`content/site.ts` defines deployment-wide settings: brand name, language, timezone, navigation, password policy. The platform reads these—it never hardcodes them.
