#!/usr/bin/env node
"use strict";

const {
  bail,
  hashPassword,
  parseArgs,
  reportPassword,
  resolvePassword,
  run,
  singlePositional,
  withClient,
} = require("./account-cli.cjs");

// Mirrors usernameSchema in lib/accounts/types.ts.
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{2,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USAGE = `用法:
  node scripts/create-account.cjs <username> --nick <昵称> --email <邮箱>

需要环境变量 DATABASE_URL。

密码从 stdin 读取，不给则自动生成并打印一次：
  printf '%s' 'correct horse battery staple' | node scripts/create-account.cjs ...

这个脚本只用于开局和救援：第一个管理员没法通过注册页产生，因为给谁提权是
content/enrollment/ 里的一次提交，而提交没法引用一个还不存在的账号的 uid。
建完之后把返回的 uid 写进一条 uids 规则，重新部署即可。

它只负责创建。改已有账号的密码用 scripts/set-password.cjs。`;

async function conflictMessage(client, constraint, values) {
  if (constraint === "accounts_username_key") {
    const { rows } = await client.query(
      "select uid from accounts where lower(username) = lower($1)",
      [values.username],
    );
    return (
      `用户名 ${values.username} 已被占用（uid=${rows[0]?.uid}）。` +
      `\n要改它的密码，用 scripts/set-password.cjs。`
    );
  }

  if (constraint === "accounts_email_key") {
    const { rows } = await client.query(
      "select uid, username from accounts where email = $1",
      [values.email],
    );
    return `邮箱 ${values.email} 已经属于账号 uid=${rows[0]?.uid}（${rows[0]?.username}）。`;
  }

  return null;
}

/**
 * Inserts the account, letting the unique indexes arbitrate. Checking first
 * would race with a concurrent insert and still need this error path.
 */
async function insertAccount(client, values) {
  try {
    const { rows } = await client.query(
      `insert into accounts
         (username, nickname, email, status, password_hash, password_set_at)
       values ($1, $2, $3, 'active', $4, now())
       returning uid`,
      [values.username, values.nick, values.email, values.passwordHash],
    );
    return rows[0].uid;
  } catch (error) {
    if (error.code !== "23505") throw error; // unique_violation

    const message = await conflictMessage(client, error.constraint, values);
    if (!message) throw error;
    bail(message);
  }
}

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    { "--nick": "nick", "--email": "email" },
    USAGE,
  );

  if (args.help) {
    console.log(USAGE);
    return;
  }

  const username = singlePositional(args.positional, "username");
  const { nick, email } = args;

  if (!username) bail(`缺少 username\n\n${USAGE}`);
  if (!USERNAME_PATTERN.test(username)) {
    bail("username 只能包含字母、数字、下划线和连字符，长度 2-32");
  }
  if (!nick) bail("缺少 --nick，账号需要一个昵称");
  if (!email) bail("缺少 --email");
  if (!EMAIL_PATTERN.test(email)) bail("邮箱格式不正确");

  const { password, generated } = await resolvePassword();

  const values = {
    username,
    nick,
    email: email.trim().toLowerCase(),
    passwordHash: await hashPassword(password),
  };

  const uid = await withClient((client) => insertAccount(client, values));

  console.log(`已创建账号 uid=${uid}（${username}，${nick}，${values.email}）`);
  reportPassword(generated, password);
  console.log(
    `\n它现在还没有任何权限。在 content/enrollment/ 加一条规则，把它放进一个带` +
      ` admin.access 能力的组，然后重新部署：\n` +
      `  { label: "…", uids: [${uid}], groups: ["…"] }`,
  );
}

run(main);
