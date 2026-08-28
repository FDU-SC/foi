#!/usr/bin/env node
"use strict";

// 把数据库清空到迁移之前的状态。
//
// 给公开 demo 站的每夜重建用：站点会积累陌生人注册的账号和垃圾提交，每天早上该是
// 一份干净的示例数据。迁移不在这里跑——应用启动时 instrumentation.ts 会自动应用。
//
// 这个脚本会删掉一切。守卫有两道，都必须显式满足。

const { bail, run, withClient } = require("./account-cli.cjs");

const CONFIRM = "yes-drop-everything";

const USAGE = `用法:
  FOI_ALLOW_DESTRUCTIVE=${CONFIRM} node scripts/db-reset.cjs

需要环境变量 DATABASE_URL。

丢弃 public schema 下的一切并重建空 schema。表结构由应用启动时的自动迁移恢复，
演示账号由 scripts/demo-seed.cjs 重新建立。

FOI_ENV=prod 时一律拒绝执行。`;

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (process.env.FOI_ALLOW_DESTRUCTIVE !== CONFIRM) {
    bail(
      `这会删除数据库里的全部数据。\n` +
        `  确认要这么做，就设置 FOI_ALLOW_DESTRUCTIVE=${CONFIRM}。`,
    );
  }

  // 第二道守卫，防的是把 demo 的环境变量套在了别的库上。前一道只证明操作者知道
  // 这个脚本会删数据，不证明他知道自己连的是哪个库。
  //
  // 装着真实数据的部署一律填 FOI_ENV=prod，预发布环境也是——tier 表达的是有没有
  // 真东西，不是发布流程里的位置。
  if (process.env.FOI_ENV === "prod") {
    bail("FOI_ENV=prod，拒绝在这套环境上清库。");
  }

  await withClient(async (client) => {
    const { rows } = await client.query(
      `select count(*)::int as tables
         from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const tables = rows[0]?.tables ?? 0;

    // drop schema 连同表、索引、类型、drizzle 的迁移记录一起走，比逐表 truncate
    // 干净：迁移记录留着的话，启动时的自动迁移会以为表都还在。
    await client.query("drop schema public cascade");
    await client.query("create schema public");

    console.log(`已清空 public schema（原有 ${tables} 张表）。`);
  });

  console.log("表结构会在应用下次启动时由自动迁移重建。");
}

run(main);
