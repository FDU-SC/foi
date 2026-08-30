import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultExclude, defineConfig } from "vitest/config";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const EVERYWHERE = ["**/*.test.{ts,tsx}"];
const DB_ONLY = ["**/*.db.test.{ts,tsx}"];

const DEPLOYMENT = ["content/**/*.test.{ts,tsx}"];

/** Operator and demo-site tooling: neither platform nor content. */
const TOOLS = ["scripts/**/*.test.{ts,tsx}"];

const NOT_SOURCE = [...defaultExclude, "**/.next/**"];

const serverOnly = {
  find: "server-only",
  replacement: fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
};

function fixture(path: string): string {
  return fileURLToPath(new URL(`./test/fixtures/content/${path}`, import.meta.url));
}

/**
 * The nine entry points the platform discovers content through, pointed at a
 * fixture the upstream owns.
 *
 * Kernel tests assert what the platform does, so they must not also assert that
 * a deployment kept some particular group or contest around. Only the
 * `deployment` project resolves these to `content/`.
 */
const FIXTURE_CONTENT = [
  "site",
  "backends",
  "_modules/contests",
  "_modules/emails",
  "_modules/enrollment",
  "_modules/policies",
  "_modules/problem-views",
  "_modules/problems",
  "_modules/rulesets",
].map((name) => ({
  find: `@/content/${name}`,
  replacement: fixture(`${name}.ts`),
}));

const againstFixture = {
  tsconfigPaths: true,
  alias: [serverOnly, ...FIXTURE_CONTENT],
};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [serverOnly],
  },
  test: {
    environment: "node",

    env: { DATABASE_URL: process.env.DATABASE_URL ?? "" },
    projects: [
      {
        extends: true,
        resolve: againstFixture,
        test: {
          name: "unit",
          include: EVERYWHERE,
          exclude: [...NOT_SOURCE, ...DB_ONLY, ...DEPLOYMENT, ...TOOLS],
        },
      },
      {
        extends: true,
        resolve: againstFixture,
        test: {
          name: "db",
          include: DB_ONLY,
          exclude: [...NOT_SOURCE, ...DEPLOYMENT, ...TOOLS],

          fileParallelism: false,
        },
      },
      {
        extends: true,

        test: {
          name: "deployment",
          include: DEPLOYMENT,
          exclude: NOT_SOURCE,

          fileParallelism: false,
        },
      },
      {
        extends: true,

        test: {
          name: "tools",
          include: TOOLS,
          exclude: NOT_SOURCE,
        },
      },
    ],
  },
});
