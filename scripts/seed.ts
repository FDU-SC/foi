import { hash } from "@node-rs/argon2";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { credentials } from "../lib/db/schema";
import { rosterEntrySchema, normalizeHandle } from "../lib/roster/types";

/**
 * Gives everyone in the roster a development password.
 *
 * The account list is no longer here — it moved to `content/roster/`, and this
 * script only supplies the one thing that cannot live in the repository. That
 * also means seeding is idempotent with respect to who exists: adding someone
 * is a roster edit, and re-running this hands them a password too.
 *
 * The roster is read straight off disk rather than through the registry,
 * because the registry is built by Turbopack's `import.meta.glob`, which a
 * standalone script cannot evaluate.
 *
 * Development only. Production issues setup codes via
 * `scripts/set-password.cjs`, so no shared password ever exists.
 */

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function loadRoster(): Promise<{ handle: string; role: string }[]> {
  const dir = join(process.cwd(), "content", "roster");
  const files = readdirSync(dir).filter((file) => file.endsWith(".ts"));
  const entries: { handle: string; role: string }[] = [];

  for (const file of files) {
    const mod: unknown = await import(pathToFileURL(join(dir, file)).href);
    const members = (mod as { members?: unknown }).members;
    if (!Array.isArray(members)) {
      throw new Error(`content/roster/${file} 必须导出名为 members 的数组`);
    }
    for (const raw of members) {
      const parsed = rosterEntrySchema.parse(raw);
      entries.push({ handle: normalizeHandle(parsed.handle), role: parsed.role });
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
    await db
      .insert(credentials)
      .values({ handle: entry.handle, passwordHash })
      .onConflictDoUpdate({
        target: credentials.handle,
        set: {
          passwordHash: sql`excluded.password_hash`,
          setupCodeHash: null,
          setupExpiresAt: null,
          updatedAt: new Date(),
        },
      });
    console.log(`  ${entry.handle.padEnd(8)} ${entry.role}`);
  }

  console.log(
    `\n已为名册中的 ${roster.length} 个账号写入密码: ${password}` +
      `\n角色与显示名来自 content/roster/，不在数据库中。`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
