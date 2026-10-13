import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const rows = async (sql) => (await c.query(sql)).rows;

console.log("judging_queue:", JSON.stringify(await rows(
  "select state, backend_id, count(*)::int as n from judging_queue group by 1,2 order by 1,2",
)));
console.log("submissions:", JSON.stringify(await rows(
  "select id, problem_slug, state from submissions order by created_at desc limit 5",
)));
console.log("contest/问题表行数:", JSON.stringify(await rows(
  "select (select count(*)::int from contests) as contests, (select count(*)::int from problems) as problems, (select count(*)::int from runners) as runners",
)));

for (const table of ["runners", "judging_queue", "judging_attempts"]) {
  const idx = await rows(
    `select indexdef from pg_indexes where tablename = '${table}' order by 1`,
  );
  console.log(`\n${table} 的索引：`);
  for (const r of idx) console.log("  -", r.indexdef);
}

// 复现 judge 侧 markRunnerSeen 生成的那条 upsert：领取时 500 的头号嫌疑。
console.log("\n复现 markRunnerSeen 的 upsert：");
try {
  await c.query(
    `insert into runners (backend_id, runner_id, last_seen_at) values ($1, $2, now())
     on conflict (backend_id, runner_id) do update set last_seen_at = now()`,
    ["common", "probe-runner"],
  );
  console.log("  OK（这条没问题）");
} catch (error) {
  console.log("  失败:", error.code, error.message);
}

await c.end();
