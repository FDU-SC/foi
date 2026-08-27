declare global {

  var __foiReaper: (() => void) | undefined;
  var __foiVerificationSweep: ReturnType<typeof setInterval> | undefined;
}

const REAP_INTERVAL_MS = 15_000;
const VERIFICATION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

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

  const { purgeExpiredVerifications } = await import(
    "@/lib/enrollment/email-verification"
  );

  const sweep = () => {
    void purgeExpiredVerifications()
      .then((count) => {
        if (count > 0) console.log(`[foi] 已清理 ${count} 条过期的邮箱验证`);
      })
      .catch((error) => console.error("[foi] 清理过期邮箱验证失败", error));
  };

  clearInterval(globalThis.__foiVerificationSweep);
  globalThis.__foiVerificationSweep = setInterval(
    sweep,
    VERIFICATION_SWEEP_INTERVAL_MS,
  );
  sweep();
}
