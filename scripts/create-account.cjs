#!/usr/bin/env node
/**
 * Creates an account from a shell, which is the only way to get the first one.
 *
 * Everybody else registers: the form proves the address, picks a handle and
 * writes the row. That cannot produce the first administrator, because a fresh
 * deployment has no administrator to name and — more to the point — because
 * naming somebody in `content/enrollment/` is a commit, and a commit cannot
 * reference an account that does not exist yet. So the order is: create the
 * account here, then add a rule naming its handle, then deploy.
 *
 * Startup used to do this instead, materialising accounts declared in the
 * repository. It meant every boot wrote to the database, and it put a
 * `displayName` field in the enrollment file that had nothing to do with
 * authorisation.
 *
 *   printf '%s' 'your-password' | docker compose exec -T app \
 *     node scripts/create-account.cjs admin --name '管理员' \
 *       --email admin@example.edu
 *
 *   # with nothing piped in, a strong password is generated and printed once
 *   docker compose exec -T app node scripts/create-account.cjs admin \
 *     --name '管理员' --email admin@example.edu
 *
 * The address is required and recorded as verified: an operator typing it at a
 * shell is a stronger check than a mailed code, and it means this account can
 * use the ordinary password reset afterwards rather than needing a second trip
 * through here. `policy.emailDomains` is deliberately not consulted — the
 * allowlist gates self-registration, and the reason to reach for this script
 * includes the external competitor whose address is not on it. Anyone who can
 * run this could write the row by hand anyway.
 */

const crypto = require("node:crypto");
const { hash } = require("@node-rs/argon2");
const { Client } = require("pg");

// Must match lib/auth/credentials.ts, or the hashes it produces would not
// verify on login.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const USAGE = `用法:
  node scripts/create-account.cjs <handle> --name <显示名> --email <邮箱>

密码从 stdin 读取；不传则自动生成并打印一次。

这个脚本只用于开局和救援：第一个管理员没法通过注册页产生，因为给谁提权是
content/enrollment/ 里的一次提交，而提交没法引用一个还不存在的账号。建完之后
把这个 handle 写进一条 handles 规则，重新部署即可。

改密码用 scripts/set-password.cjs。`;

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
    // See the note in set-password.cjs: fed through `node -`, stdin may never
    // emit 'end'.
    setTimeout(finish, 300);
  });
}

function parseArgs(argv) {
  let handle;
  let name;
  let email;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--name") {
      name = argv[(i += 1)];
    } else if (arg === "--email") {
      email = argv[(i += 1)];
    } else if (!handle) {
      handle = arg;
    }
  }

  return { handle, name, email };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const { help, handle, name, email } = parseArgs(process.argv.slice(2));

  if (help || !handle) {
    console.error(USAGE);
    process.exit(help ? 0 : 1);
  }
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(handle)) {
    fail("handle 只能包含字母、数字、下划线和连字符，长度 2-32");
  }
  if (!name) fail("缺少 --name，账号需要一个显示名");
  if (!email) fail("缺少 --email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("邮箱格式不正确");

  // Both normalised the way the application does. Sub-addresses are left alone
  // here: `policy.stripSubaddress` is about one mailbox not becoming several
  // cohorts through the registration form, and an operator typing an address
  // at a shell means the address they typed.
  const normalizedHandle = handle.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();

  let password = await readStdin();
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(18).toString("base64url");
    generated = true;
  } else if (password.length < 8) {
    fail("密码至少 8 位");
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");

    const clash = await client.query(
      "select handle from accounts where handle = $1 or email = $2",
      [normalizedHandle, normalizedEmail],
    );
    if (clash.rows.length > 0) {
      const taken = clash.rows[0].handle;
      fail(
        taken === normalizedHandle
          ? `用户名 ${normalizedHandle} 已被占用。要改它的密码，用 scripts/set-password.cjs。`
          : `邮箱 ${normalizedEmail} 已经属于账号 ${taken}。`,
      );
    }

    await client.query(
      `insert into accounts
         (handle, display_name, email, email_verified_at, source, status)
       values ($1, $2, $3, now(), 'bootstrap', 'active')`,
      [normalizedHandle, name, normalizedEmail],
    );
    await client.query(
      "insert into credentials (handle, password_hash) values ($1, $2)",
      [normalizedHandle, passwordHash],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  console.log(`已创建账号 ${normalizedHandle}（${name}，${normalizedEmail}）`);
  if (generated) {
    console.log(`密码: ${password}`);
    console.log("这是唯一一次显示，请立即保存。");
  }
  console.log(
    `\n它现在还没有任何权限。在 content/enrollment/ 加一条规则并重新部署：\n` +
      `  { label: "管理员", handles: ["${normalizedHandle}"], groups: ["管理员"] }`,
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
