// 端到端：登录 → 提交 a+b 的正确解 → 等 common 判题机给出 verdict。
import pg from "pg";

const BASE = "http://localhost:3000";
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

function saveCookies(res) {
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
  }
}

const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
saveCookies(csrfRes);
const { csrfToken } = await csrfRes.json();

const login = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
  body: new URLSearchParams({
    csrfToken,
    identifier: "admin",
    password: "foi-dev-2026",
    json: "true",
  }),
});
saveCookies(login);
const session = [...jar.keys()].find((k) => k.includes("session-token"));
console.log("登录:", login.status, session ? "拿到会话 cookie" : "没有会话 cookie（" + [...jar.keys()].join(",") + "）");

const SOURCE = `#include <iostream>
int main() {
    long long a, b;
    std::cin >> a >> b;
    std::cout << a + b << '\\n';
    return 0;
}
`;

const clientNonce = `probe-aplusb-${Date.now()}`;
const submit = await fetch(`${BASE}/api/submissions`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: cookieHeader() },
  body: JSON.stringify({
    contestSlug: "misc",
    problemSlug: "a-plus-b",
    payload: { language: "cpp", source: SOURCE },
    clientNonce,
  }),
});
const submitBody = await submit.text();
console.log("提交:", submit.status, submitBody.slice(0, 240));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let row;
for (let i = 0; i < 90; i++) {
  const res = await client.query(
    `select id, state, backend_id, backend_version, result, detail, error
       from submissions where client_nonce = $1`,
    [clientNonce],
  );
  row = res.rows[0];
  if (row && row.state !== "pending" && row.state !== "judging") break;
  if (i % 5 === 0) console.log(`  … ${row ? row.state : "（还没落库）"}`);
  await new Promise((r) => setTimeout(r, 1000));
}

console.log("\n=== verdict ===");
if (!row) {
  console.log("数据库里没有这份提交");
} else {
  console.log("state:", row.state, " backend:", row.backend_id, row.backend_version);
  console.log("result:", JSON.stringify(row.result));
  console.log("error:", row.error);
  const tests = row.detail?.tests ?? [];
  for (const t of tests) {
    console.log(`  ${String(t.name).padEnd(12)} ${String(t.status).padEnd(12)} ${t.score}/${t.maxScore} ${t.time}ms ${t.memory}KB ${t.message ?? ""}`);
  }
  console.log("detail.message:", row.detail?.message ?? "（无）");
}

await client.end();
