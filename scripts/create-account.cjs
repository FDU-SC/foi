#!/usr/bin/env node

const crypto = require("node:crypto");
const { hash } = require("@node-rs/argon2");
const { Client } = require("pg");

const ARGON2_OPTIONS = (() => {
  try {
    return require("../lib/accounts/argon2-options.cjs");
  } catch {
    return require("./lib/accounts/argon2-options.cjs");
  }
})();

const USAGE = `用法:
  node scripts/create-account.cjs <username> --nick <昵称> --email <邮箱>

密码从 stdin 读取；不传则自动生成并打印一次。

这个脚本只用于开局和救援：第一个管理员没法通过注册页产生，因为给谁提权是
content/enrollment/ 里的一次提交，而提交没法引用一个还不存在的账号的 uid。
建完之后把返回的 uid 写进一条 uids 规则，重新部署即可。

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

    setTimeout(finish, 300);
  });
}

function parseArgs(argv) {
  let username;
  let nick;
  let email;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--nick") {
      nick = argv[(i += 1)];
    } else if (arg === "--email") {
      email = argv[(i += 1)];
    } else if (!username) {
      username = arg;
    }
  }

  return { username, nick, email };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const { help, username, nick, email } = parseArgs(process.argv.slice(2));

  if (help || !username) {
    console.error(USAGE);
    process.exit(help ? 0 : 1);
  }
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(username)) {
    fail("username 只能包含字母、数字、下划线和连字符，长度 2-32");
  }
  if (!nick) fail("缺少 --nick，账号需要一个昵称");
  if (!email) fail("缺少 --email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("邮箱格式不正确");

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
      "select uid, username from accounts where lower(username) = lower($1) or email = $2",
      [username, normalizedEmail],
    );
    if (clash.rows.length > 0) {
      const taken = clash.rows[0];
      fail(
        taken.username.toLowerCase() === username.toLowerCase()
          ? `用户名 ${username} 已被占用（uid=${taken.uid}）。要改它的密码，用 scripts/set-password.cjs。`
          : `邮箱 ${normalizedEmail} 已经属于账号 uid=${taken.uid}（${taken.username}）。`,
      );
    }

    const result = await client.query(
      `insert into accounts
         (username, nickname, email, status,
          password_hash, password_set_at)
       values ($1, $2, $3, 'active', $4, now())
       returning uid`,
      [username, nick, normalizedEmail, passwordHash],
    );

    const uid = result.rows[0].uid;

    await client.query("commit");

    console.log(`已创建账号 uid=${uid}（${username}，${nick}，${normalizedEmail}）`);
    if (generated) {
      console.log(`密码: ${password}`);
      console.log("这是唯一一次显示，请立即保存。");
    }

    console.log(
      `\n它现在还没有任何权限。在 content/enrollment/ 加一条规则，把它放进一个带` +
        ` admin.access 能力的组，然后重新部署：\n` +
        `  { label: "…", uids: [${uid}], groups: ["…"] }`,
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
