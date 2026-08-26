import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __foiPool: Pool | undefined;
  var __foiDb: NodePgDatabase<typeof schema> | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("缺少环境变量 DATABASE_URL");
  }
  return new Pool({ connectionString, max: 10 });
}

/**
 * A handle that constructs `resolve()` on first property access, so importing
 * this module does not read `DATABASE_URL`.
 *
 * `next build` evaluates every route module to discover `dynamic`, run
 * `generateStaticParams`, and collect page data. Those modules import `db`
 * through the auth/accounts graph, and a pool created at import time is why
 * the Dockerfile had to feed the builder a connection string that nothing
 * ever dialed. The string is a request-time (and boot-time) concern:
 * `assertEnv` in `instrumentation.ts` still refuses a deployment that lacks
 * it, and the first query still throws the same error if that check is skipped.
 *
 * Methods are bound to the real instance: drizzle's `select` / `transaction`
 * and node's `Pool.query` all read `this`.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const instance = resolve();
      const value = Reflect.get(instance, prop, instance);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  });
}

function getPool(): Pool {
  if (process.env.NODE_ENV !== "production") {
    globalThis.__foiPool ??= createPool();
    return globalThis.__foiPool;
  }
  return (poolSingleton ??= createPool());
}

function getDb(): NodePgDatabase<typeof schema> {
  if (process.env.NODE_ENV !== "production") {
    globalThis.__foiDb ??= drizzle(getPool(), { schema });
    return globalThis.__foiDb;
  }
  return (dbSingleton ??= drizzle(getPool(), { schema }));
}

// Production keeps these on the module rather than `globalThis`: there is no
// HMR to leak a pool per edit, and one evaluation per process is the singleton.
let poolSingleton: Pool | undefined;
let dbSingleton: NodePgDatabase<typeof schema> | undefined;

export const db: NodePgDatabase<typeof schema> = lazy(getDb);
export const pool: Pool = lazy(getPool);
export * from "./schema";
