import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultExclude, defineConfig } from "vitest/config";
import { CONTENT_SLOT, DEPLOYMENT_ROOTS } from "./test/content-roots.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const EVERYWHERE = ["**/*.test.{ts,tsx}"];
const DB_ONLY = ["**/*.db.test.{ts,tsx}"];

const tests = (root: string) => `${root}/**/*.test.{ts,tsx}`;

/**
 * Tests that describe one deployment: the sample content, plus whatever a fork
 * put in the slots. None of them belong to the kernel projects, which answer a
 * different question against a fixture.
 */
const ANY_DEPLOYMENT = DEPLOYMENT_ROOTS.map(tests);

/**
 * The deployment suite covers the sample too. A fork that fills the content
 * slot still inherits most of `content/` by fallback — its rulesets, judges and
 * mail templates — and the tests next to them still describe what runs.
 *
 * One file is the exception. `content/deployment.test.ts` pins the upstream
 * sample by name (which contest, which penalty, which demo account); once the
 * slot supplies its own content those sentences describe nothing, so the fork
 * writes its own copy and this one steps aside. Anything else under `content/`
 * keeps running — dropping the whole root would silently retire a fork's own
 * tests along with it.
 */
const SLOT_FILLED = existsSync(CONTENT_SLOT);

const SUPERSEDED = SLOT_FILLED ? ["content/deployment.test.ts"] : [];

const DEPLOYMENT = ANY_DEPLOYMENT;

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
 * The entry points the platform discovers content through, pointed at a
 * fixture the upstream owns.
 *
 * Kernel tests assert what the platform does, so they must not also assert that
 * a deployment kept some particular group or contest around. Only the
 * `deployment` project resolves these to `content/`.
 */
const FIXTURE_CONTENT = [
  "site",
  "site-views",
  "backends",
  "schema",
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
          exclude: [...NOT_SOURCE, ...DB_ONLY, ...ANY_DEPLOYMENT, ...TOOLS],
        },
      },
      {
        extends: true,
        resolve: againstFixture,
        test: {
          name: "db",
          include: DB_ONLY,
          exclude: [...NOT_SOURCE, ...ANY_DEPLOYMENT, ...TOOLS],

          fileParallelism: false,
        },
      },
      {
        extends: true,

        test: {
          name: "deployment",
          include: DEPLOYMENT,
          exclude: [...NOT_SOURCE, ...SUPERSEDED],

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
