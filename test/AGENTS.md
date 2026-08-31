# test/ — Kernel Test Support

Everything here belongs to the upstream platform. A fork should not need to edit
this directory; its edits go in the slots.

## Four Projects, Two Content Sets

`vitest.config.mts` declares four projects, and which content they see is the
whole point of the split:

| Project | Includes | Subject | Resolves `@/content/*` to |
|---|---|---|---|
| `unit` | the rest | the platform | `test/fixtures/content/` |
| `db` | `**/*.db.test.{ts,tsx}` | the platform, against Postgres | `test/fixtures/content/` |
| `deployment` | `content/` and every `.local` root | that deployment | whatever tsconfig resolves |
| `tools` | `scripts/**/*.test.{ts,tsx}` | operator and demo-site tooling | not redirected — must not import it |

`deployment` covers the sample as well as the slots. A fork that fills the
content slot still inherits most of `content/` by fallback — its rulesets,
judges, mail templates — and the tests beside those files still describe what
runs. `content/deployment.test.ts` is the one exception: it pins the upstream
sample by name, so a filled slot excludes it and the fork writes its own.

Tests a fork writes beside its own overrides — under `content.local/`,
`components.local/` or `views.local/` — land in `deployment` too. They describe
one deployment against its real content, which is the opposite of what a kernel
test does. `test/content-roots.mjs` is the single list of slots.

The redirect covers the twelve entry points the platform discovers content
through — the seven `_modules/` registries plus `site.ts`, `site-views.tsx`,
`backends.ts`, `schema.ts` and `theme.css`.

The reason: a kernel test asks whether the platform is correct. If it also
required this deployment to keep a particular group or contest around, then
retiring either one downstream would fail tests that have nothing to do with the
change. Deployment facts are asserted in `content/deployment.test.ts`, which a
fork owns along with the rest of `content/`.

`tools` exists for the same reason one step removed. `scripts/stub-runner.cjs`
serves the nightly demo site, and `scripts/mock-runner.ts` stands in for a judge
locally; neither is the platform, so their tests do not belong in a suite that
gates it. They also must not name a real problem, backend or group — supply a
placeholder, as `stub-runner.test.ts` does.

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
asserts the redirect is live, the other fails if any test outside `content/` —
including one under `scripts/` — imports `content/` directly.

`test/slots.test.ts` guards the other boundary: that every slot's alias resolves
local-first, that `app/` holds nothing but route shells, and that no file in
`app/`, `views/` or `components/` reaches into `content/`.

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
