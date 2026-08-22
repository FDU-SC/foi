import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __foiPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("缺少环境变量 DATABASE_URL");
  }
  return new Pool({ connectionString, max: 10 });
}

// Reused across HMR reloads so `next dev` does not leak a pool per edit.
const pool = globalThis.__foiPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__foiPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
export * from "./schema";
