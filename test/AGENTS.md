# test/ — Kernel Test Support

Everything here belongs to the upstream platform. A fork should not need to edit
this directory; its edits go in `content/`.

## Three Projects, Two Content Sets

`vitest.config.mts` declares three projects, and which content they see is the
whole point of the split:

| Project | Includes | Resolves `@/content/*` to |
|---|---|---|
| `unit` | everything except `*.db.test` and `content/**` | `test/fixtures/content/` |
| `db` | `**/*.db.test.{ts,tsx}` | `test/fixtures/content/` |
| `deployment` | `content/**/*.test.{ts,tsx}` | `content/` |

The redirect covers the nine entry points the platform discovers content
through — the seven `_modules/` registries plus `site.ts` and `backends.ts`.

The reason: a kernel test asks whether the platform is correct. If it also
required this deployment to keep a particular group or contest around, then
retiring either one downstream would fail tests that have nothing to do with the
change. Deployment facts are asserted in `content/deployment.test.ts`, which a
fork owns along with the rest of `content/`.

## Writing a Kernel Test

Ask for a **shape**, never a name:

```ts
import { viewerWith, viewerAllowedOnly, retiredProblem } from "@/test/content-shapes";

const admin = viewerWith("admin.enter");                       // some group with this action
const partial = viewerAllowedOnly("admin.enter", "account.read"); // in, but not all the way
const gone = retiredProblem();
```

`test/content-shapes.ts` derives these from the policy set and the registries at
runtime. Every helper throws a named error when the shape is missing, so a gap
in the fixture reads as "the fixture lacks X" rather than as an unrelated
assertion failure.

Two guards in `test/fixtures/content/fixture.test.ts` keep this honest: one
asserts the redirect is live, the other fails if any kernel test imports
`content/` directly.

## Changing the Fixture

`test/fixtures/content/` is a complete, minimal content set: four problems, two
contests, one ruleset, one policy file, four groups.

Its shapes are load-bearing — the contest limits entry to a group and overrides
a rate limit, one problem is retired, one is externally judged, one is inline,
one is audience-gated, and the ruleset implements the freeze contract. Add a
shape when a new kernel test needs one, and add the matching assertion to
`fixture.test.ts` so the next editor learns why it exists.

The `_modules/` files declare their module tables by hand, keyed the way
`import.meta.glob` would key them, because the registries parse slugs and
ruleset ids back out of those keys.
