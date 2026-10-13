// 端到端：把官方参考解当作提交交给 lu，等 common 判题机给出 verdict。
import { readFileSync } from "node:fs";
import pg from "pg";

const BASE = "http://localhost:3000";
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const save = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [p] = c.split(";");
    const i = p.indexOf("=");
    jar.set(p.slice(0, i).trim(), p.slice(i + 1));
  }
};

let r = await fetch(`${BASE}/api/auth/csrf`);
save(r);
const { csrfToken } = await r.json();
r = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
  body: new URLSearchParams({ csrfToken, identifier: "admin", password: "foi-dev-2026", json: "true" }),
});
save(r);

const source = readFileSync("C:/Users/63226/Documents/tmp/foi/.tmp/lu-std-solver.cpp", "utf8");
console.log("提交源码长度:", source.length);

const nonce = `probe-lu-${Date.now()}`;
const sub = await fetch(`${BASE}/api/submissions`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: cookieHeader() },
  body: JSON.stringify({
    contestSlug: "kernel",
    problemSlug: "lu",
    payload: { language: "cpp", source },
    clientNonce: nonce,
  }),
});
console.log("提交:", sub.status, (await sub.text()).slice(0, 120));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let row;
for (let i = 0; i < 180; i++) {
  const q = await client.query(
    "select id, state, backend_id, backend_version, result, detail, error from submissions where client_nonce = $1",
    [nonce],
  );
  row = q.rows[0];
  if (row && row.state !== "pending" && row.state !== "judging") break;
  if (i % 10 === 0) console.log(`  … ${row ? row.state : "（还没落库）"}`);
  await new Promise((res) => setTimeout(res, 1000));
}

console.log("\n=== verdict ===");
console.log("state:", row?.state, " backend:", row?.backend_id, row?.backend_version);
console.log("result:", JSON.stringify(row?.result));
console.log("error:", row?.error ?? "（无）");
for (const t of row?.detail?.tests ?? []) {
  console.log(`   ${String(t.name).padEnd(10)} ${String(t.status).padEnd(20)} ${t.score}/${t.maxScore}  ${t.time}ms  ${t.memory}KB`);
  if (t.message) console.log(`      ${t.message}`);
}
await client.end();
