declare global {

  var __foiReaper: (() => void) | undefined;
}

const REAP_INTERVAL_MS = 15_000;

export async function register() {

  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertBootConfiguration } = await import("@/lib/boot/checks");
  await assertBootConfiguration();

  if (process.env.FOI_AUTO_MIGRATE !== "false") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { db } = await import("@/lib/db");
    await migrate(db, { migrationsFolder: "drizzle" });
    console.log("[foi] 数据库迁移已应用");
  }

  const { startReaping } = await import("@/lib/runner/reaper");

  globalThis.__foiReaper?.();
  globalThis.__foiReaper = startReaping(REAP_INTERVAL_MS);
}
