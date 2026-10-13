declare global {

  var __foiReaper: (() => void) | undefined;
}

const REAP_INTERVAL_MS = 15_000;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertBootConfiguration } = await import("@/lib/boot/checks");
    await assertBootConfiguration();

    if (process.env.FOI_AUTO_MIGRATE !== "false") {
      const { existsSync } = await import("node:fs");
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      const { db } = await import("@/lib/db");
      const { deploymentMigrationConfig, platformMigrationConfig } =
        await import("@/lib/db/migration-config");
      const hasDeployment = existsSync(`${deploymentMigrationConfig.migrationsFolder}/meta/_journal.json`);
      if (hasDeployment) {
        const { prepareDeploymentMigrationJournal } = await import("@/lib/db/migration-journal");
        await prepareDeploymentMigrationJournal(db);
      }

      await migrate(db, platformMigrationConfig);

      // A deployment's own tables migrate from their own folder, keeping their
      // own journal, so its version numbers never contend with the upstream's.
      if (hasDeployment) {
        await migrate(db, deploymentMigrationConfig);
      }

      const { log } = await import("@/lib/log");
      log.info("数据库迁移已应用");
    }

    // Problems authored in the console live in the database, and the registries
    // that reach a problem are synchronous. Loading them once here is what puts
    // them in front of every reader; publishing reloads them in the process that
    // published, and this process looks again on its own timer in case another
    // one did.
    const { refreshLibrary, startLibraryRefresh } = await import("@/lib/problems/library");
    await refreshLibrary();
    startLibraryRefresh();

    // The boot checks above ran before the library existed, so an authored
    // problem is checked here instead. Losing its last contest — which happens
    // when the repository drops the contest rather than when anyone edits the
    // problem — leaves it with no URL, and that is worth saying at start-up
    // rather than discovering as a 404.
    const { log } = await import("@/lib/log");
    const { orphanedProblemComplaints } = await import("@/lib/contests/warnings");
    for (const complaint of orphanedProblemComplaints()) log.warn(complaint);

    const { startReaping } = await import("@/lib/runner/reaper");

    globalThis.__foiReaper?.();
    globalThis.__foiReaper = startReaping(REAP_INTERVAL_MS);
  }
}
