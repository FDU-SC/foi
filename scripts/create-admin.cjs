#!/usr/bin/env node
/**
 * Creates (or resets) an administrator account.
 *
 * Runs inside the app container, which already has the database URL and the
 * same argon2 implementation the login path uses:
 *
 *   docker compose exec -T app node scripts/create-admin.cjs <handle> [显示名]
 *
 * The password is read from stdin when something is piped in, so it stays out
 * of shell history and the process list:
 *
 *   printf '%s' 'your-password' | docker compose exec -T app \
 *     node scripts/create-admin.cjs admin 管理员
 *
 * With nothing piped in, a strong password is generated and printed once.
 *
 * Re-running against an existing handle resets that account's password and
 * promotes it to admin, which is also the recovery path for a lost password.
 */

const crypto = require("node:crypto");
const { hash } = require("@node-rs/argon2");
const { Client } = require("pg");

// Must match auth.ts, or the hashes it produces would not verify on login.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Inlined because the runtime image does not carry the `ulid` package; keeps
// ids in the same format the seed script produces.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid() {
  let now = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[now % 32] + time;
    now = Math.floor(now / 32);
  }
  const bytes = crypto.randomBytes(16);
  let random = "";
  for (const b of bytes) random += CROCKFORD[b % 32];
  return time + random;
}

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

async function main() {
  const handle = process.argv[2];
  const displayName = process.argv[3] || handle;

  if (!handle) {
    console.error("用法: node scripts/create-admin.cjs <handle> [显示名]");
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(handle)) {
    console.error("handle 只能包含字母、数字、下划线和连字符，长度 2-32");
    process.exit(1);
  }

  let password = await readStdin();
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(18).toString("base64url");
    generated = true;
  } else if (password.length < 8) {
    console.error("密码至少 8 位");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const passwordHash = await hash(password, ARGON2_OPTIONS);
    const { rows } = await client.query(
      `insert into users (id, handle, display_name, password_hash, role)
       values ($1, $2, $3, $4, 'admin')
       on conflict (handle) do update
         set password_hash = excluded.password_hash,
             role          = 'admin',
             disabled      = false
       returning (xmax = 0) as created`,
      [ulid(), handle, displayName, passwordHash],
    );

    const created = rows[0]?.created;
    console.log(created ? `已创建管理员 ${handle}` : `已重置 ${handle} 的密码并提升为管理员`);
    if (generated) {
      console.log(`密码: ${password}`);
      console.log("这是唯一一次显示，请立即保存。");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
