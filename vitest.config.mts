import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

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
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["lib/**/*.test.ts", "content/**/*.test.ts"],
          exclude: ["lib/**/*.db.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["lib/**/*.db.test.ts"],
          // These share one database; running files in parallel would have
          // them stepping on each other's rows.
          fileParallelism: false,
        },
      },
    ],
  },
});
