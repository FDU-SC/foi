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

let poolSingleton: Pool | undefined;
let dbSingleton: NodePgDatabase<typeof schema> | undefined;

export const db: NodePgDatabase<typeof schema> = lazy(getDb);
export const pool: Pool = lazy(getPool);
export * from "./schema";
