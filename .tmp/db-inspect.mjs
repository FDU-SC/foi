import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const rows = async (sql) => (await c.query(sql)).rows;

const mig = await rows(
  "select count(*)::int as n, max(created_at) as latest from drizzle.__drizzle_migrations",
);
console.log("drizzle 记录的迁移：", mig[0]);

const tables = await rows(
  "select tablename from pg_tables where schemaname='public' order by 1",
);
console.log("public 表：", tables.map((r) => r.tablename).join(", "));

const idx = await rows(
  "select indexname, indexdef from pg_indexes where tablename = 'accounts' order by 1",
);
console.log("accounts 的索引/约束：");
for (const r of idx) console.log("  -", r.indexdef);

const cols = await rows(
  "select column_name from information_schema.columns where table_name='accounts' order by ordinal_position",
);
console.log("accounts 的列：", cols.map((r) => r.column_name).join(", "));

console.log("服务器版本：", (await rows("show server_version")).map((r) => r.server_version)[0]);
await c.end();
