declare global {

  var __foiReaper: (() => void) | undefined;
}

const REAP_INTERVAL_MS = 15_000;

export async function register() {

  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertBootConfiguration } = await import("@/lib/boot/checks");
  await assertBootConfiguration();

  if (process.env.FOI_AUTO_MIGRATE !== "false") {
    const { existsSync } = await import("node:fs");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { db } = await import("@/lib/db");
    const { deploymentMigrationConfig, platformMigrationConfig } =
      await import("@/lib/db/migration-config");

    await migrate(db, platformMigrationConfig);

    // A deployment's own tables migrate from their own folder, keeping their
    // own journal table, so its timestamps never contend with the upstream's.
    if (
      existsSync(`${deploymentMigrationConfig.migrationsFolder}/meta/_journal.json`)
    ) {
      await migrate(db, deploymentMigrationConfig);
    }

    console.log("[foi] 数据库迁移已应用");
  }

  const { startReaping } = await import("@/lib/runner/reaper");

  globalThis.__foiReaper?.();
  globalThis.__foiReaper = startReaping(REAP_INTERVAL_MS);
}
