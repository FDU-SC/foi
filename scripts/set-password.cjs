#!/usr/bin/env node
/**
 * Manages the one thing that cannot live in the repository: a password.
 *
 * People get accounts by registering, and recover them over email. What is
 * left for this script is the case where neither is possible — an address that
 * has stopped working, a reset mail that never arrives. It refuses to invent
 * an account: creating one is `scripts/create-account.cjs`, and keeping the
 * two apart means neither has to explain which half it is doing.
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
 *   # clear a departed member's credentials, and retire any reset link still
 *   # in flight. The account and its submissions stay — nothing here deletes
 *   # an account, and `submissions.handle` is ON DELETE RESTRICT precisely so
 *   # that whoever eventually tries has to deal with the history first
 *   docker compose exec -T app node scripts/set-password.cjs --revoke alice
 *
 * This is also the recovery path when nobody can reach /admin. It is the only
 * way in that does not involve email, which is why it requires a shell on the
 * server: anyone who can run this could already read the database.
 */

const crypto = require("node:crypto");
const { hash } = require("@node-rs/argon2");
const { Client } = require("pg");

// Two paths because a file fed through `node -` has no directory of its own,
// so `./` resolves against the working directory instead of against this
// script. The alternative is a fourth copy of the parameters, which is the
// thing the shared file exists to prevent — see the comment in it.
const ARGON2_OPTIONS = (() => {
  try {
    return require("./argon2-options.cjs");
  } catch {
    return require("./scripts/argon2-options.cjs");
  }
})();

const USAGE = `用法:
  node scripts/set-password.cjs <handle>          设置或重置密码
  node scripts/set-password.cjs --revoke <handle> 清除凭据

本脚本不创建账号：账号由注册产生，第一个管理员用 scripts/create-account.cjs 建。
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
 * Credentials hang off an account, so there has to be one. Creating it is a
 * different job with different arguments — a display name, an address — and
 * belongs to `create-account.cjs`.
 */
async function requireAccount(client, handle) {
  const { rows } = await client.query(
    "select status from accounts where handle = $1",
    [handle],
  );
  if (rows.length === 0) {
    console.error(`没有名为 ${handle} 的账号。`);
    console.error(
      "账号由注册产生。开局的第一个管理员用 scripts/create-account.cjs 创建。",
    );
    process.exit(1);
  }
  return rows[0];
}

/**
 * Runs a mode's writes as a single act.
 *
 * Both modes write twice — the credentials row, and then the reset links that
 * could rewrite it — and neither half means what it says without the other. A
 * revoke that cleared the password and then failed would leave a departed
 * member holding a live link and nothing standing between them and a fresh
 * credentials row, which is the one outcome revoking exists to rule out. A set
 * that failed the same way would leave a stale link able to undo the password
 * just chosen. Rolled back, the operator sees an error and the account is
 * exactly as it was, which is the state a retry expects.
 *
 * `create-account.cjs` already does this around its two inserts; the two
 * scripts having one answer here is worth as much as the answer.
 */
async function atomically(client, run) {
  await client.query("begin");
  try {
    const result = await run();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
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

  // Hashed before the transaction opens: argon2 is deliberately slow, and a
  // transaction held across it is one holding row locks for no reason.
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const created = await atomically(client, async () => {
    const { rows } = await client.query(
      `insert into credentials (handle, password_hash)
       values ($1, $2)
       on conflict (handle) do update
         set password_hash = excluded.password_hash,
             updated_at    = now()
       returning (xmax = 0) as created`,
      [handle, passwordHash],
    );

    // Setting a password by hand retires any reset link already in flight, so
    // a stale email cannot undo what was just done here.
    await client.query(
      `update auth_tokens set consumed_at = now()
       where handle = $1 and purpose = 'password_reset' and consumed_at is null`,
      [handle],
    );

    return rows[0]?.created;
  });

  console.log(created ? `已为 ${handle} 设置密码` : `已重置 ${handle} 的密码`);
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
  const { cleared, retired } = await atomically(client, async () => {
    const { rowCount: cleared } = await client.query(
      "delete from credentials where handle = $1",
      [handle],
    );

    // The same sweep the set path does, and it matters more here: a departed
    // member with a reset link still in their inbox could spend it and write
    // themselves a fresh credentials row, which is the one outcome revoking is
    // meant to rule out. That is also why the two are one transaction —
    // stopping in between produces precisely that state.
    const { rowCount: retired } = await client.query(
      `update auth_tokens set consumed_at = now()
       where handle = $1 and purpose = 'password_reset' and consumed_at is null`,
      [handle],
    );

    return { cleared, retired };
  });

  console.log(
    cleared > 0 ? `已清除 ${handle} 的凭据` : `${handle} 没有凭据记录`,
  );
  if (retired > 0) {
    console.log(`同时作废了 ${retired} 个未使用的重置链接。`);
  }
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
