import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { accounts } from "../lib/db/schema";
import ARGON2_OPTIONS from "../lib/accounts/argon2-options.cjs";

if (process.env.NODE_ENV === "production") {
  console.error(
    "seed 仅限本地开发，会写入统一弱密码；NODE_ENV=production 时拒绝运行。",
  );
  process.exit(1);
}

interface SeedAccount {
  username: string;
  nickname: string;
  email: string | null;
}

const SEED_ACCOUNTS: SeedAccount[] = [
  {
    username: "admin",
    nickname: "管理员",
    email: "admin@example.test",
  },
  {
    username: "alice",
    nickname: "Alice",
    email: "23300240001@example.test",
  },
  {
    username: "bob",
    nickname: "Bob",
    email: "23300240002@example.test",
  },
  {
    username: "carol",
    nickname: "Carol",
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
        username: entry.username,
        nickname: entry.nickname,
        email: entry.email,
        status: "active",
        passwordHash,
        passwordSetAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: accounts.username,
        set: {
          nickname: sql`excluded.nickname`,
          email: sql`excluded.email`,
          status: sql`'active'`,
          passwordHash: sql`excluded.password_hash`,
          passwordSetAt: sql`excluded.password_set_at`,
          updatedAt: sql`now()`,
        },
      });

    console.log(`  ${entry.username.padEnd(8)} ${entry.email ?? "（无邮箱）"}`);
  }

  console.log(
    `\n已创建 ${SEED_ACCOUNTS.length} 个账号，密码统一为: ${password}`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
