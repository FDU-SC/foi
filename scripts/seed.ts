import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ulid } from "ulid";
import { users } from "../lib/db/schema";

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const ACCOUNTS = [
  { handle: "admin", displayName: "管理员", role: "admin" as const },
  { handle: "alice", displayName: "Alice", role: "user" as const },
  { handle: "bob", displayName: "Bob", role: "user" as const },
  { handle: "carol", displayName: "Carol", role: "user" as const },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("缺少环境变量 DATABASE_URL");

  const password = process.env.FOI_SEED_PASSWORD ?? "foi-dev-2026";
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  for (const account of ACCOUNTS) {
    await db
      .insert(users)
      .values({ id: ulid(), passwordHash, ...account })
      .onConflictDoUpdate({
        target: users.handle,
        set: { displayName: account.displayName, role: account.role },
      });
    console.log(`  ${account.handle.padEnd(8)} ${account.role}`);
  }

  console.log(`\n已写入 ${ACCOUNTS.length} 个账号，统一密码: ${password}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
