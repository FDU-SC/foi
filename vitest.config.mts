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
 * itself, which is a different question from anything the kernel asks.
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
 * There is no fixture content, and that is the arrangement rather than a gap.
 *
 * The kernel's suites run against whatever `content/` is mounted, on purpose:
 * the gates, the action whitelist and the submission path are written against
 * the live registries, and a fixture registry would happily agree with a gate
 * that had drifted, or fail to notice a contest file that forgot a problem.
 * What they must not do is name a slug — they ask by shape, and the shapes are
 * listed in `test/content-shapes.ts`.
 *
 * A tree with no `content/` at all therefore does not run these suites; it
 * runs `pnpm typecheck`, `pnpm build` and the smoke check, which is what the
 * `content-absent` job does. Handing the kernel a fixture so that it could run
 * tests there too would only have those tests assert the fixture's facts.
 */
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
        test: {
          name: "unit",
          include: EVERYWHERE,
          exclude: [...NOT_SOURCE, ...DB_ONLY, ...DEPLOYMENT],
        },
      },
      {
        extends: true,
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
        // Separate because it asks a different question. These are `content/`
        // checking its own work — that the demo round charges twenty penalty
        // minutes, that the verdict table is actually wired into the
        // presentation export — and none of it is a fact about the platform.
        // A deployment that replaces this directory replaces these too.
        test: {
          name: "deployment",
          include: DEPLOYMENT,
          exclude: NOT_SOURCE,
          // Nothing here declares `passWithNoTests`, and nothing needs to: a
          // project contributing no files is only an error when *no* project
          // contributes any, so this one matching nothing — a deployment that
          // writes no tests about itself — passes on the strength of the two
          // above. Setting it at the root instead would buy this case at the
          // price of the one worth catching, which is a typo in `include`
          // turning a suite off in silence.
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
