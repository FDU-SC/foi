import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { MigrationMeta } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { db } from "./index";
import { prepareDeploymentMigrationJournal } from "./migration-journal";
import { deploymentMigrationConfig, platformMigrationConfig } from "./migration-config";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const migration = (name: string, timestamp: number): MigrationMeta => ({
  hash: name, folderMillis: timestamp, bps: true,
  sql: [`CREATE TABLE "${name}" (id integer)`],
});

describeDb("旧部署迁移 journal 升级", () => {
  it.each([true, false])("旧公共 journal=%s 时迁移记录隔离且重启不重放", async (legacyDeployment) => {
    const rollback = new Error("rollback test transaction");
    await expect(db.transaction(async (tx) => {
      // Everything, including the temporary journal contents, rolls back.
      await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations
        (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
      await tx.execute(sql`TRUNCATE drizzle.__drizzle_migrations`);
      await tx.execute(sql`DROP TABLE IF EXISTS drizzle.__drizzle_local_migrations`);
      const platform = [migration("journal_test_initial", 50), migration("journal_test_platform", 200)];
      const deployment = [migration("journal_test_deployment", legacyDeployment ? 300 : 100)];
      const dialect = new PgDialect();
      // PgDialect is exercised against the real transaction's PostgreSQL session.
      const rawSession = (tx as unknown as { session: { all: (query: unknown) => Promise<unknown> } }).session;
      const session = {
        execute: tx.execute.bind(tx),
        all: rawSession.all.bind(rawSession),
        transaction: tx.transaction.bind(tx),
      } as never;
      if (legacyDeployment) {
        await dialect.migrate(platform.slice(0, 1), session, platformMigrationConfig);
        await dialect.migrate(deployment, session, platformMigrationConfig);
      }

      for (let restart = 0; restart < 2; restart++) {
        await prepareDeploymentMigrationJournal(tx, platform, deployment);
        await dialect.migrate(platform, session, platformMigrationConfig);
        await dialect.migrate(deployment, session, deploymentMigrationConfig);
      }
      const upstream = await tx.execute(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`);
      const local = await tx.execute(sql`SELECT hash FROM drizzle.__drizzle_local_migrations`);
      expect(upstream.rows).toEqual([{ hash: "journal_test_initial" }, { hash: "journal_test_platform" }]);
      expect(local.rows).toEqual([{ hash: "journal_test_deployment" }]);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("hash 无法区分平台和部署时拒绝修改 journal", async () => {
    const same = migration("ambiguous", 100);
    await expect(prepareDeploymentMigrationJournal(db, [same], [same]))
      .rejects.toThrow("平台迁移与部署迁移的 hash 重复");
  });
});
