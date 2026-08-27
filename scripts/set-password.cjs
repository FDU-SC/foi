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

const USAGE = `用法:
  node scripts/set-password.cjs <username>
  node scripts/set-password.cjs --uid <uid>

需要环境变量 DATABASE_URL。

密码从 stdin 读取，不给则自动生成并打印一次：
  printf '%s' 'correct horse battery staple' | node scripts/set-password.cjs alice

这个脚本用于救援：邮件发不出去、忘记密码流程走不通时，从服务器上直接改密码。
改完之后该账号所有已登录的会话立即失效，需要重新登录。

username 允许纯数字，所以按 uid 定位必须显式写 --uid，不会去猜。
新建账号用 scripts/create-account.cjs。`;

async function findAccount(client, { username, uid }) {
  const [column, value] =
    uid !== undefined ? ["uid = $1", uid] : ["lower(username) = lower($1)", username];

  const { rows } = await client.query(
    `select uid, username, nickname, status from accounts where ${column}`,
    [value],
  );

  if (!rows[0]) {
    bail(uid !== undefined ? `没有 uid=${uid} 的账号` : `没有叫 ${username} 的账号`);
  }
  return rows[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { "--uid": "uid" }, USAGE);

  if (args.help) {
    console.log(USAGE);
    return;
  }

  const username = singlePositional(args.positional, "username");

  if (username === undefined && args.uid === undefined) {
    bail(`要指定改谁：给一个 username，或者 --uid\n\n${USAGE}`);
  }
  if (username !== undefined && args.uid !== undefined) {
    bail("username 和 --uid 只能给一个");
  }

  let uid;
  if (args.uid !== undefined) {
    if (!/^[0-9]+$/.test(args.uid)) bail("--uid 要是一个正整数");
    uid = Number(args.uid);
  }

  const { password, generated } = await resolvePassword();
  const passwordHash = await hashPassword(password);

  const account = await withClient(async (client) => {
    const found = await findAccount(client, { username, uid });

    // password_set_at is what invalidates live sessions: auth.ts compares it
    // against the passwordAt claim on every request, so bumping it logs the
    // account out everywhere.
    await client.query(
      `update accounts
          set password_hash = $2, password_set_at = now(), updated_at = now()
        where uid = $1`,
      [found.uid, passwordHash],
    );

    return found;
  });

  console.log(
    `已给 uid=${account.uid}（${account.username}，${account.nickname}）设置新密码。`,
  );
  reportPassword(generated, password);
  console.log("\n该账号现有的登录会话已全部失效，需要用新密码重新登录。");

  if (account.status !== "active") {
    console.log(
      `注意：这个账号当前是 ${account.status}，改了密码也登不进去，还得先解封。`,
    );
  }
}

run(main);
