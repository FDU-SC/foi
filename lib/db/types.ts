import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type DbOrTx = PgDatabase<NodePgQueryResultHKT, typeof schema>;
