import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultExclude, defineConfig } from "vitest/config";

// Node's own parser rather than a shell `source`, which chokes on unquoted
// values like `FOI_MAIL_FROM=FOI <foi@localhost>`. This is only for local
// runs; CI puts DATABASE_URL in the environment directly.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/**
 * Tests run on Vite, which is also where `import.meta.glob` comes from — the
 * content registries therefore load here the same way Turbopack loads them,
 * with no stubbing.
 *
 * Three projects because they answer to different things. `unit` is pure
 * functions and runs anywhere; `db` talks to a real Postgres and skips itself
 * when there is none, so a checkout without a database still gets the scoring
 * and signature coverage. `deployment` is the tests `content/` writes about
 * itself, and it is separate for the reason spelled out under
 * `FOI_TEST_CONTENT` below.
 *
 * The first two collect from the whole tree rather than from a list of
 * directories. They used to name `lib/` and `content/`, which meant a test
 * written beside a server action or a route handler was collected by nothing
 * and reported by nothing: `vitest run` says how many files passed, never
 * which ones it declined to look for. A directory list is only correct until
 * somebody puts a test somewhere sensible that is not on it, and the cost of
 * being wrong is a green run.
 *
 * That is not an invitation to test pages. Most of what a route handler or an
 * action does is worth testing one layer down, where it can be reached without
 * a request — see `lib/submissions/submit-route.db.test.ts`, which exercises
 * the submission endpoint's rules against the mechanism rather than the
 * handler. The point here is only that choosing to write the test elsewhere
 * must be a choice, not something the runner decides in silence.
 */
const EVERYWHERE = ["**/*.test.{ts,tsx}"];
const DB_ONLY = ["**/*.db.test.{ts,tsx}"];

/** What a deployment says about its own rounds, problems and copy. */
const DEPLOYMENT = ["content/**/*.test.{ts,tsx}"];

// Vitest replaces its own defaults when `exclude` is given, and `.next/`
// contains compiled copies of anything it has seen.
const NOT_SOURCE = [...defaultExclude, "**/.next/**"];

const serverOnly = {
  find: "server-only",
  replacement: fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
};

/**
 * Where the kernel's suites get their content from.
 *
 * Unset, which is the default and what a developer gets: the repository's own
 * `content/`. That arrangement is worth keeping as the default — the gates,
 * the action whitelist and the submission path are written against the live
 * registries on purpose, because a fixture registry would happily agree with a
 * gate that had drifted, and would not catch a contest file that forgot a
 * problem.
 *
 * `skeleton` points the eight `@/content-*-modules` specifiers at the matching
 * `test/skeleton-*-modules.ts`, which glob `test/content-skeleton/`. That is
 * not a way of switching the checks off: the same suites run with the same
 * assertions, only the material comes from a fixture the kernel owns rather
 * than from a deployment. It exists because `test/content-shapes.ts` asks
 * `content/` for seven shapes, and the `content-absent` CI job deletes
 * `content/` outright — without this, proving the platform boots with no
 * content would mean giving up on running its tests at the same time.
 *
 * One rule with a capture rather than eight entries, and eight files on the
 * other side rather than one: see the note in
 * `test/skeleton-problem-modules.ts` on why merging them deadlocks the loader.
 */
const skeleton = {
  find: /^@\/content-([a-z-]+)-modules$/,
  replacement: `${fileURLToPath(new URL("./test", import.meta.url))}/skeleton-$1-modules.ts`,
};

const kernelAlias =
  process.env.FOI_TEST_CONTENT === "skeleton"
    ? [serverOnly, skeleton]
    : [serverOnly];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [serverOnly],
  },
  test: {
    environment: "node",
    // Only the database. A test that needs more of a deployment's environment
    // stubs it itself, next to the assertions that depend on it — see
    // `lib/submissions/submit-route.db.test.ts`, which reaches for a public URL
    // and a backend key in its own `beforeAll`. Putting those here would hand
    // every test file a configuration one of them wanted, and would put
    // something shaped like a signing key in a checked-in config file.
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "" },
    projects: [
      {
        extends: true,
        resolve: { alias: kernelAlias },
        test: {
          name: "unit",
          include: EVERYWHERE,
          exclude: [...NOT_SOURCE, ...DB_ONLY, ...DEPLOYMENT],
        },
      },
      {
        extends: true,
        resolve: { alias: kernelAlias },
        test: {
          name: "db",
          include: DB_ONLY,
          exclude: [...NOT_SOURCE, ...DEPLOYMENT],
          // These share one database; running files in parallel would have
          // them stepping on each other's rows.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        // Deliberately without the skeleton alias, whatever `FOI_TEST_CONTENT`
        // says. These tests are `content/` checking its own work — that the
        // demo round charges twenty penalty minutes, that the verdict table is
        // actually wired into the presentation export — and pointing them at a
        // fixture would have them assert the fixture's facts and pass.
        resolve: { alias: [serverOnly] },
        test: {
          name: "deployment",
          include: DEPLOYMENT,
          exclude: NOT_SOURCE,
          // Nothing here declares `passWithNoTests`, and nothing needs to: a
          // project contributing no files is only an error when *no* project
          // contributes any, so this one matching nothing — a deployment with
          // no tests, or the `content-absent` job's empty tree — passes on the
          // strength of the two above. Setting it at the root instead would
          // buy this case at the price of the one worth catching, which is a
          // typo in `include` turning a suite off in silence.
          //
          // Collects `content/`'s database tests too, rather than leaving them
          // to the `db` project, which excludes this directory. Serial for the
          // same reason that one is: there is only ever one database.
          fileParallelism: false,
        },
      },
    ],
  },
});
