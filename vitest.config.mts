import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultExclude, defineConfig } from "vitest/config";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const EVERYWHERE = ["**/*.test.{ts,tsx}"];
const DB_ONLY = ["**/*.db.test.{ts,tsx}"];

const DEPLOYMENT = ["content/**/*.test.{ts,tsx}"];

const NOT_SOURCE = [...defaultExclude, "**/.next/**"];

const serverOnly = {
  find: "server-only",
  replacement: fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
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
    ],
  },
});
