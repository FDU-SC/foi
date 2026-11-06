import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformMigrationConfig } from "@/lib/db/migration-config";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "db-reset.cjs");

// The script drops schemas, so it runs against a database of its own and never
// against the one the other suites share.
const DATABASE = `foi_db_reset_${randomBytes(4).toString("hex")}`;

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** What `instrumentation.ts` does on every boot. */
function bootMigrate(url: string): Promise<void> {
  return withClient(url, (client) => migrate(drizzle(client), platformMigrationConfig));
}

function reset(url: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: url,
      FOI_ENV: "dev",
      FOI_ALLOW_DESTRUCTIVE: "yes-drop-everything",
    },
    encoding: "utf8",
  });
}

describeDb("db-reset.cjs", () => {
  let url = "";

  beforeAll(async () => {
    await withClient(process.env.DATABASE_URL!, (client) =>
      client.query(`create database "${DATABASE}"`));
    url = databaseUrl(DATABASE);
  });

  afterAll(async () => {
    if (!url) return;
    await withClient(process.env.DATABASE_URL!, (client) =>
      client.query(`drop database if exists "${DATABASE}" with (force)`));
  });

  it("清库后下一次启动迁移会重建全部表，旧数据不留", async () => {
    await bootMigrate(url);
    await withClient(url, (client) => client.query(
      "insert into accounts (username, nickname) values ('reset-marker', 'reset-marker')",
    ));

    const result = reset(url);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);

    await bootMigrate(url);

    const applied = readMigrationFiles(platformMigrationConfig).length;
    await withClient(url, async (client) => {
      const { rows: [journal] } = await client.query(
        "select count(*)::int as count from drizzle.__drizzle_migrations",
      );
      expect(journal.count).toBe(applied);

      const { rows: [accounts] } = await client.query(
        "select count(*)::int as count from accounts",
      );
      expect(accounts.count).toBe(0);
    });
  }, 60_000);
});
