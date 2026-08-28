#!/usr/bin/env node
"use strict";

// 建立公开 demo 站的演示账号。
//
// demo 站不开放自助注册（注册要过邮箱验证，而演示邮箱域名并不存在），访客靠这批
// 固定账号试用。账号数量固定本身就是配额上限——限流按账号计数，而一个开放注册的
// 站点有多少账号就有多少份配额。
//
// 幂等：已存在的账号只重置密码，不报错。每夜重建会连着 db-reset.cjs 一起跑。
//
// 纯 CommonJS，理由同 account-cli.cjs：运行镜像里没有 tsx。

const {
  bail,
  hashPassword,
  parseArgs,
  run,
  withClient,
} = require("./account-cli.cjs");

const USAGE = `用法:
  FOI_DEMO_PASSWORD=<密码> node scripts/demo-seed.cjs [--count 5] [--prefix demo]

需要环境变量 DATABASE_URL 与 FOI_DEMO_PASSWORD。

密码会公示在 demo 站首页，所以由调用方显式给出，不自动生成。
已存在的账号会被重置成这个密码，不会报错。`;

// 与 content/site.ts 的 passwordMinLength 保持一致。
const PASSWORD_MIN_LENGTH = 8;

/** 演示账号用的邮箱域名。不存在的域名，收不到也发不出。 */
const EMAIL_DOMAIN = "example.test";

async function upsert(client, account) {
  const { rows } = await client.query(
    "select uid from accounts where lower(username) = lower($1)",
    [account.username],
  );

  if (rows.length > 0) {
    const { uid } = rows[0];
    await client.query(
      `update accounts
          set nickname = $2,
              email = $3,
              status = 'active',
              password_hash = $4,
              password_set_at = now()
        where uid = $1`,
      [uid, account.nickname, account.email, account.passwordHash],
    );
    return { uid, created: false };
  }

  const inserted = await client.query(
    `insert into accounts
       (username, nickname, email, status, password_hash, password_set_at)
     values ($1, $2, $3, 'active', $4, now())
     returning uid`,
    [account.username, account.nickname, account.email, account.passwordHash],
  );
  return { uid: inserted.rows[0].uid, created: true };
}

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
    { "--count": "count", "--prefix": "prefix" },
    USAGE,
  );

  if (args.help) {
    console.log(USAGE);
    return;
  }

  const password = process.env.FOI_DEMO_PASSWORD;
  if (!password) bail(`缺少环境变量 FOI_DEMO_PASSWORD\n\n${USAGE}`);
  if (password.length < PASSWORD_MIN_LENGTH) {
    bail(`FOI_DEMO_PASSWORD 至少 ${PASSWORD_MIN_LENGTH} 位`);
  }

  const count = args.count === undefined ? 5 : Number(args.count);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    bail("--count 要是 1 到 50 之间的整数");
  }

  const prefix = args.prefix ?? "demo";
  if (!/^[a-z][a-z0-9_-]{0,16}$/.test(prefix)) {
    bail("--prefix 只能是小写字母开头的短标识");
  }

  // 一次哈希，所有账号共用。argon2 每个账号跑一遍要几百毫秒，而这批账号的密码
  // 本来就是同一个、而且是公开的。
  const passwordHash = await hashPassword(password);

  const created = [];
  await withClient(async (client) => {
    for (let index = 1; index <= count; index += 1) {
      const username = `${prefix}${index}`;
      const outcome = await upsert(client, {
        username,
        nickname: `演示账号 ${index}`,
        email: `${username}@${EMAIL_DOMAIN}`,
        passwordHash,
      });
      created.push({ username, ...outcome });
    }
  });

  const fresh = created.filter((account) => account.created).length;
  console.log(
    `演示账号就绪：新建 ${fresh} 个，重置 ${created.length - fresh} 个`,
  );
  for (const account of created) {
    console.log(`  ${account.username}（uid=${account.uid}）`);
  }
  console.log("\n这些账号没有任何额外权限，密码是公开的，不要在正式环境创建。");
}

run(main);
