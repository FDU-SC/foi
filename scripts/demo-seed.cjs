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
已存在的账号会被重置成这个密码，不会报错。

空库上会先插一个没有密码的保留账号，占住被分流规则点名成管理员的那个 uid。`;

// 与 content/site.ts 的 passwordMinLength 保持一致。
const PASSWORD_MIN_LENGTH = 8;

/** 演示账号用的邮箱域名。不存在的域名，收不到也发不出。 */
const EMAIL_DOMAIN = "example.test";

// 与 content/enrollment/example.ts 里那条按 uid 点名管理员的规则保持一致。
const RESERVED_UID = 1;
const RESERVED_USERNAME = "reserved";

/**
 * 占住 uid=1。分流规则按 uid 点名管理员，而演示账号的密码是公示的：不占住它，
 * db-reset 之后第一个建出来的演示账号就会顺位捡到那份权限。
 *
 * 这一行没有密码哈希，登录必定失败（见 lib/accounts/password.ts 的 verifyPassword）。
 * 运维要用它进 /admin，在服务器上跑 scripts/set-password.cjs 给它设个密码即可。
 */
async function reserve(client) {
  const held = await client.query(
    "select uid, username from accounts where uid = $1",
    [RESERVED_UID],
  );
  if (held.rows.length > 0) return { ...held.rows[0], created: false };

  // 只有空库才谈得上占位：identity 序列走过的号回不来，非空库里插进去的行拿不到它。
  const existing = await client.query("select 1 from accounts limit 1");
  if (existing.rows.length > 0) return null;

  const inserted = await client.query(
    `insert into accounts (username, nickname, status)
     values ($1, '保留账号', 'active')
     returning uid, username`,
    [RESERVED_USERNAME],
  );
  return { ...inserted.rows[0], created: true };
}

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
  let reserved = null;
  await withClient(async (client) => {
    reserved = await reserve(client);

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

  const captured = created.find((account) => account.uid === RESERVED_UID);
  if (captured) {
    bail(
      `${captured.username} 拿到了 uid=${RESERVED_UID}，而分流规则按这个 uid 点名管理员。` +
        `\n演示账号的密码是公开的，不能带着那份权限上线：先 scripts/db-reset.cjs 清库再重跑。`,
    );
  }

  if (reserved) {
    console.log(
      reserved.created
        ? `保留账号 ${reserved.username}（uid=${reserved.uid}）已建，它没有密码，登不进去`
        : `uid=${RESERVED_UID} 已归 ${reserved.username}，未改动`,
    );
  }

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
