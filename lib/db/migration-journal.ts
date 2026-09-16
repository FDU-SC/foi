import { sql } from "drizzle-orm";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import type { db as database } from "./index";
import { deploymentMigrationConfig, platformMigrationConfig } from "./migration-config";

/** Move identifiable deployment records out of the legacy shared journal. */
export async function prepareDeploymentMigrationJournal(
  db: Pick<typeof database, "transaction">,
  platform: MigrationMeta[] = readMigrationFiles(platformMigrationConfig),
  deployment: MigrationMeta[] = readMigrationFiles(deploymentMigrationConfig),
) {
  const platformHashes = new Set(platform.map((migration) => migration.hash));
  if (deployment.some((migration) => platformHashes.has(migration.hash))) {
    throw new Error("平台迁移与部署迁移的 hash 重复，无法区分旧迁移记录");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_local_migrations (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
    )`);
    const legacy = await tx.execute(sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS journal`);
    if (!legacy.rows[0]?.journal) return;

    // Serialize journal upgrades, and keep copy/delete atomic across restarts.
    await tx.execute(sql`LOCK TABLE drizzle.__drizzle_migrations, drizzle.__drizzle_local_migrations IN EXCLUSIVE MODE`);
    for (const migration of deployment) {
      await tx.execute(sql`
        INSERT INTO drizzle.__drizzle_local_migrations (hash, created_at)
        SELECT hash, created_at FROM drizzle.__drizzle_migrations old
        WHERE hash = ${migration.hash} AND created_at = ${migration.folderMillis}
          AND NOT EXISTS (
            SELECT 1 FROM drizzle.__drizzle_local_migrations local
            WHERE local.hash = old.hash AND local.created_at = old.created_at
          )
      `);
      await tx.execute(sql`DELETE FROM drizzle.__drizzle_migrations
        WHERE hash = ${migration.hash} AND created_at = ${migration.folderMillis}`);
    }
  });
}
