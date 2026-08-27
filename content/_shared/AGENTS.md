# _shared/ — Reusable Template Library

This directory contains **composable building blocks** for problems, contests, and rulesets. These are NOT platform defaults—they are a menu of common implementations that content authors pick from.

If nothing here fits, write your own component in the problem/contest directory.

## Directory Layout

```
_shared/
  ui/             Submission UI templates
    submit-panel.tsx    Shell — handles submit state, verdict display, login gate
    submit-context.tsx  React context — exposes submit(payload) + submitting to children
    code-input.tsx      Template — language select + code textarea → { language, source }
    flag-input.tsx      Template — single-line input → { flag }
    text-input.tsx      Template — multi-line textarea → { text }
    ui-config.tsx       ProblemUi schema (difficulty, tags, languages, placeholder)
    problem-badges.tsx  Problem list badges (difficulty + tags + max score)
  views/           Submission detail view templates
    code-payload.tsx    Renders { language, source } payloads
    flag-payload.tsx    Renders { flag } payloads
    text-payload.tsx    Renders { text } payloads
    tests-table.tsx     Renders { tests: [...] } verdict detail as a table
  judges/          Inline judge templates
    output-only.ts      Judge for answer-submission problems (compare against expected values)
    roulette.ts         Judge for randomized scoring problems
    life-oscillator.ts  Judge for Game of Life oscillator problems
  mdx/             MDX components for problem statements
    callout.tsx         Callout boxes (note, tip, warning, danger)
    constraints.tsx     Time/memory limit display
    sample.tsx          Sample input/output with copy buttons
    copy-button.tsx     Copy-to-clipboard button
  verdicts.ts      Global verdict translation table (AC/WA/TLE/MLE/RE/CE/...)
  presentation.tsx Assembly file — wires templates into the Presentation interface
```

## Shell + Template Pattern

The submission UI follows a shell-template pattern:

- **SubmitPanel** (shell) handles: Card container, `useSubmit` hook, verdict display, error messages, login gate. It does NOT understand what is being submitted.
- **Input templates** (CodeInput, FlagInput, TextInput) handle: collecting user input and calling `submit(payload)`. Each produces a specific payload shape.

In problem statement MDX:

```tsx
<SubmitPanel>
  <CodeInput />           {/* or FlagInput, TextInput, or your own */}
</SubmitPanel>
```

For custom submission types, write your own input component that consumes the submit context:

```tsx
import { useSubmitContext } from "@/content/_shared/ui/submit-context";

function MyCustomInput() {
  const { submit, submitting } = useSubmitContext();
  // ... your UI ... call submit({ myCustomPayload }) on form submit
}
```

## Views

Each problem's `views.tsx` picks view templates for displaying submissions:

- `PayloadView` — how to render the submitted content on the detail page
- `VerdictDetail` — how to render evaluation details (test cases, messages)
- `verdicts` — optional per-problem verdict label overrides

## Adding New Templates

To add a new submission type (e.g., file upload):

1. Create `_shared/ui/file-upload-input.tsx` — consumes submit context, produces `{ fileUrl }`
2. Create `_shared/views/file-payload.tsx` — renders `{ fileUrl }` on the detail page
3. Register the MDX component in `_shared/presentation.tsx`
4. Use in problem statements: `<SubmitPanel><FileUploadInput /></SubmitPanel>`
