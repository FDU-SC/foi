import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { accounts, credentials } from "../lib/db/schema";
import ARGON2_OPTIONS from "../scripts/argon2-options.cjs";

/**
 * Creates the development accounts and gives them all one password.
 *
 * Content, not platform. The addresses below are shaped to match the rules in
 * `content/enrollment/example.ts` — `demo` for everyone, plus an intake year
 * for the three with a student-number-shaped local part — which is what makes
 * `content/contests/demo-acm/`, whose field is selected by tag, show a
 * populated standings page on a fresh checkout. None of that survives swapping
 * the directory. The kernel's own way to create an account is
 * `scripts/create-account.cjs`, which asks for a handle and a password and
 * knows nothing about cohorts.
 *
 * Development only. In production nobody is seeded: people register, and the
 * first administrator comes from `scripts/create-account.cjs`.
 */

// Every seeded account shares one well-known password, so running this against
// anything but a local checkout hands out working credentials. Refuse rather
// than rely on the operator noticing the comment above.
//
// The condition reads as "production" and blocks rather more than that: the
// Dockerfile sets NODE_ENV=production and all three deployed environments run
// that same image, so dev and staging are refused too. That is the intent — a
// shared weak password is no safer on the tailnet than on the public site — but
// it means this is a guard against being deployed at all, not against one
// environment.
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
  source: "bootstrap" | "registration";
}

/**
 * Written out rather than derived from the enrollment rules, because these are
 * meant to stand in for people who registered. `admin` is the exception: it is
 * what `scripts/create-account.cjs` produces in production, which is why it is
 * marked `bootstrap` and why the rule in `content/enrollment/example.ts` names
 * it.
 */
const SEED_ACCOUNTS: SeedAccount[] = [
  {
    handle: "admin",
    displayName: "管理员",
    email: "admin@example.test",
    source: "bootstrap",
  },
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
      `\n用户组不在数据库中，全部由 content/enrollment/ 的规则现算：admin 被一条 handles 规则点名，其余三个按邮箱分流。`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
