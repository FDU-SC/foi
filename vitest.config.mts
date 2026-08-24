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
 * Two projects because they need different things. `unit` is pure functions
 * and runs anywhere; `db` talks to a real Postgres and skips itself when there
 * is none, so a checkout without a database still gets the scoring and
 * signature coverage.
 *
 * Both collect from the whole tree rather than from a list of directories.
 * They used to name `lib/` and `content/`, which meant a test written beside
 * a server action or a route handler was collected by nothing and reported by
 * nothing: `vitest run` says how many files passed, never which ones it
 * declined to look for. A directory list is only correct until somebody puts
 * a test somewhere sensible that is not on it, and the cost of being wrong is
 * a green run.
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

// Vitest replaces its own defaults when `exclude` is given, and `.next/`
// contains compiled copies of anything it has seen.
const NOT_SOURCE = [...defaultExclude, "**/.next/**"];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./test/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Only the database. A test that needs more of a deployment's environment
    // stubs it itself, next to the assertions that depend on it — see
    // `lib/submissions/callback.db.test.ts`. Putting those here would hand 26
    // files a configuration one of them wanted, and would put something shaped
    // like a signing key in a checked-in config file.
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: EVERYWHERE,
          exclude: [...NOT_SOURCE, ...DB_ONLY],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: DB_ONLY,
          exclude: NOT_SOURCE,
          // These share one database; running files in parallel would have
          // them stepping on each other's rows.
          fileParallelism: false,
        },
      },
    ],
  },
});
