import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { accounts, credentials } from "../lib/db/schema";

/**
 * Creates the development accounts and gives them all one password.
 *
 * This used to hand a password to everybody in the roster, because the roster
 * was who existed. Now people exist by registering, so a seed has to actually
 * create them — which is the honest shape for a seed script, and means the
 * rows it writes look exactly like the ones the registration form produces.
 *
 * The addresses are chosen to match the rules in
 * `content/enrollment/example.ts`: `demo` for everyone, and an intake year for
 * the three that carry a student-number-shaped local part. That is what makes
 * `content/contests/demo-acm/` — which selects its field by tag — show a
 * populated standings page on a fresh checkout.
 *
 * Development only. In production nobody is seeded: people register, and the
 * bootstrap administrator gets a password from `scripts/set-password.cjs`.
 */

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

interface SeedAccount {
  handle: string;
  displayName: string;
  email: string | null;
  source: "bootstrap" | "registration";
}

/**
 * Written out rather than derived from the enrollment grants, because these
 * are meant to stand in for people who registered. Only `admin` is declared in
 * the repository, and it has no address for the same reason the real one will
 * not: nobody mailed it an invitation.
 */
const SEED_ACCOUNTS: SeedAccount[] = [
  { handle: "admin", displayName: "管理员", email: null, source: "bootstrap" },
  {
    handle: "alice",
    displayName: "Alice",
    email: "23300240001@example.test",
    source: "registration",
  },
  {
    handle: "bob",
    displayName: "Bob",
    email: "23300240002@example.test",
    source: "registration",
  },
  {
    handle: "carol",
    displayName: "Carol",
    email: "24300240003@example.test",
    source: "registration",
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
        // Seeded accounts skip the mail round trip but are otherwise ordinary
        // verified ones, so cohort rules apply to them exactly as they would
        // to somebody who clicked the link.
        emailVerifiedAt: entry.email ? new Date() : null,
        source: entry.source,
        status: "active",
      })
      .onConflictDoUpdate({
        target: accounts.handle,
        set: {
          displayName: sql`excluded.display_name`,
          email: sql`excluded.email`,
          emailVerifiedAt: sql`excluded.email_verified_at`,
          status: sql`'active'`,
          updatedAt: new Date(),
        },
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

    console.log(`  ${entry.handle.padEnd(8)} ${entry.email ?? "（无邮箱）"}`);
  }

  console.log(
    `\n已创建 ${SEED_ACCOUNTS.length} 个账号，密码统一为: ${password}` +
      `\n用户组不在数据库中：一部分来自 content/enrollment/ 的 grants，一部分由邮箱按规则现算。`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
