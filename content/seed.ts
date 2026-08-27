import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { accounts } from "../lib/db/schema";
import ARGON2_OPTIONS from "../lib/accounts/argon2-options.cjs";

if (process.env.NODE_ENV === "production") {
  console.error(
    "seed 会写入统一弱密码的账号，仅限本地开发；检测到 NODE_ENV=production（三套部署环境都会命中），拒绝运行。",
  );
  process.exit(1);
}

interface SeedAccount {
  handle: string;
  displayName: string;
  email: string | null;
}

const SEED_ACCOUNTS: SeedAccount[] = [
  {
    handle: "admin",
    displayName: "管理员",
    email: "admin@example.test",
  },
  {
    handle: "alice",
    displayName: "Alice",
    email: "23300240001@example.test",
  },
  {
    handle: "bob",
    displayName: "Bob",
    email: "23300240002@example.test",
  },
  {
    handle: "carol",
    displayName: "Carol",
    email: "24300240003@example.test",
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("缺少环境变量 DATABASE_URL");

  const password = process.env.FOI_SEED_PASSWORD ?? "foi-dev-2026";
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  for (const entry of SEED_ACCOUNTS) {
    await db
      .insert(accounts)
      .values({
        handle: entry.handle,
        displayName: entry.displayName,
        email: entry.email,
        status: "active",
        passwordHash,
        passwordSetAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: accounts.handle,
        set: {
          displayName: sql`excluded.display_name`,
          email: sql`excluded.email`,
          status: sql`'active'`,
          passwordHash: sql`excluded.password_hash`,
          passwordSetAt: sql`excluded.password_set_at`,
          updatedAt: sql`now()`,
        },
      });

    console.log(`  ${entry.handle.padEnd(8)} ${entry.email ?? "（无邮箱）"}`);
  }

  console.log(
    `\n已创建 ${SEED_ACCOUNTS.length} 个账号，密码统一为: ${password}` +
      `\n用户组不在数据库中，全部由 content/enrollment/ 的规则现算：admin 被一条 handles 规则点名，其余三个按邮箱分流。`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
