#!/usr/bin/env node
/**
 * Manages the one thing that cannot live in the repository: a password.
 *
 * Roles, display names and membership all come from `content/roster/`, so this
 * script no longer creates accounts — it only issues credentials for handles
 * the roster already knows. A credentials row for an unlisted handle is inert:
 * login checks the roster first and rejects anyone who is not on it.
 *
 * Runs inside the app container, which already has the database URL and the
 * same argon2 implementation the login path uses:
 *
 *   # set or reset a password, read from stdin so it stays out of the
 *   # shell history and the process list
 *   printf '%s' 'your-password' | docker compose exec -T app \
 *     node scripts/set-password.cjs admin
 *
 *   # with nothing piped in, a strong password is generated and printed once
 *   docker compose exec -T app node scripts/set-password.cjs admin
 *
 *   # hand someone a code instead, and let them choose their own password
 *   docker compose exec -T app node scripts/set-password.cjs --issue-code alice
 *
 *   # clear a departed member's credentials (fails if they have submissions,
 *   # which are kept deliberately: the foreign key is ON DELETE RESTRICT)
 *   docker compose exec -T app node scripts/set-password.cjs --revoke alice
 *
 * This is also the recovery path when nobody can reach /admin — for instance
 * the very first deploy, before any administrator has a password.
 */

const crypto = require("node:crypto");
const { hash } = require("@node-rs/argon2");
const { Client } = require("pg");

// Must match lib/auth/credentials.ts, or the hashes it produces would not
// verify on login.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const SETUP_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const USAGE = `用法:
  node scripts/set-password.cjs <handle>              设置或重置密码
  node scripts/set-password.cjs --issue-code <handle> 签发一次性设置码
  node scripts/set-password.cjs --revoke <handle>     清除凭据

用户名、显示名与角色的真源是 content/roster/，本脚本不创建账号。`;

function readStdin() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (stdin.isTTY || stdin.destroyed || stdin.readableEnded) {
      return resolve("");
    }

    let data = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(data.trim());
    };

    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => (data += chunk));
    stdin.on("end", finish);
    stdin.on("error", finish);
    // Deliberately not unref'd. When this file is fed through `node -`, stdin
    // has already been drained as the script source and may never emit 'end';
    // an unref'd timer would let the process exit before doing any work.
    setTimeout(finish, 300);
  });
}

function parseArgs(argv) {
  let mode = "set";
  let handle;

  for (const arg of argv) {
    if (arg === "--issue-code") mode = "issue-code";
    else if (arg === "--revoke") mode = "revoke";
    else if (arg === "--help" || arg === "-h") mode = "help";
    else if (!handle) handle = arg;
  }

  return { mode, handle };
}

async function setPassword(client, handle) {
  let password = await readStdin();
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(18).toString("base64url");
    generated = true;
  } else if (password.length < 8) {
    console.error("密码至少 8 位");
    process.exit(1);
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);
  const { rows } = await client.query(
    `insert into credentials (handle, password_hash)
     values ($1, $2)
     on conflict (handle) do update
       set password_hash    = excluded.password_hash,
           setup_code_hash  = null,
           setup_expires_at = null,
           updated_at       = now()
     returning (xmax = 0) as created`,
    [handle, passwordHash],
  );

  console.log(
    rows[0]?.created ? `已为 ${handle} 设置密码` : `已重置 ${handle} 的密码`,
  );
  if (generated) {
    console.log(`密码: ${password}`);
    console.log("这是唯一一次显示，请立即保存。");
  }
  console.log(
    `提醒: ${handle} 还需要出现在 content/roster/ 中才能登录，角色也在那里定义。`,
  );
}

async function issueCode(client, handle) {
  const code = crypto.randomBytes(20).toString("base64url");
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + SETUP_CODE_TTL_MS);

  await client.query(
    `insert into credentials (handle, setup_code_hash, setup_expires_at)
     values ($1, $2, $3)
     on conflict (handle) do update
       set setup_code_hash  = excluded.setup_code_hash,
           setup_expires_at = excluded.setup_expires_at,
           updated_at       = now()`,
    [handle, codeHash, expiresAt],
  );

  console.log(`已为 ${handle} 签发设置码:`);
  console.log(`  ${code}`);
  console.log(`在 /setup 页面使用，${expiresAt.toISOString()} 前有效。`);
  console.log("这是唯一一次显示，请立即转交本人。");
}

async function revoke(client, handle) {
  const { rowCount } = await client.query(
    "delete from credentials where handle = $1",
    [handle],
  );
  console.log(
    rowCount > 0 ? `已清除 ${handle} 的凭据` : `${handle} 没有凭据记录`,
  );
}

async function main() {
  const { mode, handle } = parseArgs(process.argv.slice(2));

  if (mode === "help" || !handle) {
    console.error(USAGE);
    process.exit(handle ? 0 : 1);
  }
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(handle)) {
    console.error("handle 只能包含字母、数字、下划线和连字符，长度 2-32");
    process.exit(1);
  }

  // The database keeps handles in one canonical form; the roster registry
  // looks them up the same way.
  const normalized = handle.trim().toLowerCase();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (mode === "issue-code") await issueCode(client, normalized);
    else if (mode === "revoke") await revoke(client, normalized);
    else await setPassword(client, normalized);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
