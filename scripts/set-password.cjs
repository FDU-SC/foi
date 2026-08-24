#!/usr/bin/env node
/**
 * Manages the one thing that cannot live in the repository: a password.
 *
 * People get accounts by registering, and recover them over email. What is
 * left for this script is the case where neither is possible — the bootstrap
 * administrator on a fresh deploy, who is declared in the repository and has
 * no address to mail. It therefore refuses to invent an account: the handle
 * must already have one.
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
 *   # clear a departed member's credentials (fails if they have submissions,
 *   # which are kept deliberately: the foreign key is ON DELETE RESTRICT)
 *   docker compose exec -T app node scripts/set-password.cjs --revoke alice
 *
 * This is also the recovery path when nobody can reach /admin — for instance
 * the very first deploy, before any administrator has a password. It is the
 * only way in that does not involve email, which is why it requires a shell on
 * the server: anyone who can run this could already read the database.
 */

const crypto = require("node:crypto");
const { hash } = require("@node-rs/argon2");
const { Client } = require("pg");

// Must match lib/auth/credentials.ts, or the hashes it produces would not
// verify on login.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const USAGE = `用法:
  node scripts/set-password.cjs <handle>          设置或重置密码
  node scripts/set-password.cjs --revoke <handle> 清除凭据

本脚本不创建账号：账号由注册产生，引导管理员由 content/enrollment/ 声明并在启动时建行。
需要让本人自己设密码时，在 /admin/accounts 点「发送重置邮件」，链接直达其邮箱。`;

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
    if (arg === "--revoke") mode = "revoke";
    else if (arg === "--help" || arg === "-h") mode = "help";
    else if (!handle) handle = arg;
  }

  return { mode, handle };
}

/**
 * Credentials hang off an account now, so there has to be one. The bootstrap
 * administrator gets theirs from the grant sync at startup, which is why the
 * remedy is a deploy rather than a flag on this script: an account nobody
 * declared and nobody registered should not spring into being from a shell.
 */
async function requireAccount(client, handle) {
  const { rows } = await client.query(
    "select status from accounts where handle = $1",
    [handle],
  );
  if (rows.length === 0) {
    console.error(`没有名为 ${handle} 的账号。`);
    console.error(
      "账号由注册产生。若要开通引导管理员，先在 content/enrollment/ 的 grants 中声明该 handle（带 displayName），重新部署后启动同步会建行。",
    );
    process.exit(1);
  }
  return rows[0];
}

async function setPassword(client, handle) {
  const account = await requireAccount(client, handle);

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
       set password_hash = excluded.password_hash,
           updated_at    = now()
     returning (xmax = 0) as created`,
    [handle, passwordHash],
  );

  // Setting a password by hand retires any reset link already in flight, so a
  // stale email cannot undo what was just done here.
  await client.query(
    `update auth_tokens set consumed_at = now()
     where handle = $1 and purpose = 'password_reset' and consumed_at is null`,
    [handle],
  );

  console.log(
    rows[0]?.created ? `已为 ${handle} 设置密码` : `已重置 ${handle} 的密码`,
  );
  if (generated) {
    console.log(`密码: ${password}`);
    console.log("这是唯一一次显示，请立即保存。");
  }
  if (account.status !== "active") {
    console.log(
      `提醒: ${handle} 当前状态为 ${account.status}，密码已设置但尚不能登录。`,
    );
  }
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

  // The database keeps handles in one canonical form; every registry lookup
  // normalises the same way.
  const normalized = handle.trim().toLowerCase();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (mode === "revoke") await revoke(client, normalized);
    else await setPassword(client, normalized);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
