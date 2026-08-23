import { hash } from "@node-rs/argon2";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { accounts, credentials } from "../lib/db/schema";
import { normalizeHandle } from "../lib/accounts/types";
import { rosterEntrySchema } from "../lib/roster/types";

/**
 * Creates the development accounts and gives them all one password.
 *
 * In production nobody is seeded: people register, and the bootstrap
 * administrator gets a password over `scripts/set-password.cjs`. This exists
 * so that a fresh checkout has somebody to log in as without setting up a mail
 * server first, which is the same reason `scripts/mock-judge.ts` exists.
 *
 * The roster is read straight off disk rather than through the registry,
 * because the registry is built by Turbopack's `import.meta.glob`, which a
 * standalone script cannot evaluate.
 */

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

interface SeedAccount {
  handle: string;
  displayName: string;
  role: string;
}

async function loadRoster(): Promise<SeedAccount[]> {
  const dir = join(process.cwd(), "content", "roster");
  const files = readdirSync(dir).filter((file) => file.endsWith(".ts"));
  const entries: SeedAccount[] = [];

  for (const file of files) {
    const mod: unknown = await import(pathToFileURL(join(dir, file)).href);
    const members = (mod as { members?: unknown }).members;
    if (!Array.isArray(members)) {
      throw new Error(`content/roster/${file} 必须导出名为 members 的数组`);
    }
    for (const raw of members) {
      const parsed = rosterEntrySchema.parse(raw);
      entries.push({
        handle: normalizeHandle(parsed.handle),
        displayName: parsed.displayName,
        role: parsed.role,
      });
    }
  }

  return entries;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("缺少环境变量 DATABASE_URL");

  const roster = await loadRoster();
  if (roster.length === 0) {
    throw new Error("名册为空，请先在 content/roster/ 下添加成员");
  }

  const password = process.env.FOI_SEED_PASSWORD ?? "foi-dev-2026";
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  for (const entry of roster) {
    // The account has to exist before the credential can reference it.
    await db
      .insert(accounts)
      .values({
        handle: entry.handle,
        displayName: entry.displayName,
        source: "bootstrap",
        status: "active",
      })
      .onConflictDoUpdate({
        target: accounts.handle,
        set: { status: sql`'active'`, updatedAt: new Date() },
      });

    await db
      .insert(credentials)
      .values({ handle: entry.handle, passwordHash })
      .onConflictDoUpdate({
        target: credentials.handle,
        set: {
          passwordHash: sql`excluded.password_hash`,
          updatedAt: new Date(),
        },
      });
    console.log(`  ${entry.handle.padEnd(8)} ${entry.role}`);
  }

  console.log(
    `\n已为 ${roster.length} 个账号建行并写入密码: ${password}` +
      `\n角色来自 content/roster/，不在数据库中。`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
