// Logs in with a seeded account and fetches a problem page, to prove the page
// renders rather than merely type-checks.
const BASE = "http://localhost:3000";
const jar = new Map();

function saveCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
  }
}

const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

let res = await fetch(`${BASE}/api/auth/csrf`);
saveCookies(res);
const { csrfToken } = await res.json();

res = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
  body: new URLSearchParams({
    csrfToken,
    username: process.env.PROBE_USER ?? "admin",
    password: process.env.PROBE_PASSWORD ?? "foi-dev-2026",
    json: "true",
  }),
});
saveCookies(res);
console.log("登录:", res.status, "cookies:", [...jar.keys()].join(",") || "（无）");

const path = process.argv[2] ?? "/problems/misc/a-plus-b";
res = await fetch(`${BASE}${path}`, { headers: { cookie: cookieHeader() } });
const html = await res.text();
console.log("页面:", res.status, "长度", html.length);

const needles = [
  ["标题", "A + B Problem"],
  ["题面正文", "给定两个整数"],
  ["我的 Callout", "只收 C++"],
  ["样例", "1000000000"],
  ["难度徽章", "入门"],
  ["测试点", "4"],
];
for (const [label, needle] of needles) {
  console.log(html.includes(needle) ? "  ✓" : "  ✗", label, JSON.stringify(needle));
}

if (res.status !== 200) console.log(html.slice(0, 600));
