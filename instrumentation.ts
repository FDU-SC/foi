declare global {
  /**
   * Not a timer handle. The reaper reschedules itself, so the only thing worth
   * keeping across a hot reload is something that can stop whichever tick is
   * pending — see `startReaping`.
   */
  var __foiReaper: (() => void) | undefined;
  var __foiVerificationSweep: ReturnType<typeof setInterval> | undefined;
}

/**
 * How often the queue is swept for jobs nobody is looking after.
 *
 * Well under `HEARTBEAT_LAPSE_MS`, so the delay between a runner going quiet
 * and its work being handed to somebody else is dominated by the lapse itself
 * rather than by when this happens to fire. A pass is four indexed statements
 * over partial indexes that are empty in the healthy case, so there is no
 * reason to be stingier.
 */
const REAP_INTERVAL_MS = 15_000;
const VERIFICATION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export async function register() {
  // The registry is Turbopack-built and Node-only; skip other runtimes.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // First, and for the same reason the migration below aborts startup: a
  // deployment that cannot work should say so while the health check is still
  // watching, rather than at whichever request first needs the missing value.
  //
  // One call rather than the four asserts and six warning sources this used to
  // spell out. What is fatal depends on the tier, and that is one decision for
  // the whole process — see `lib/boot/checks.ts`.
  const { assertBootConfiguration } = await import("@/lib/boot/checks");
  await assertBootConfiguration();

  // Runs before anything touches the schema. Drizzle records applied
  // migrations in its own table, so this is a no-op once up to date. A failure
  // here deliberately aborts startup rather than serving against a stale
  // schema — the deploy then fails loudly instead of half-working.
  if (process.env.FOI_AUTO_MIGRATE !== "false") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { db } = await import("@/lib/db");
    await migrate(db, { migrationsFolder: "drizzle" });
    console.log("[foi] 数据库迁移已应用");
  }

  // Nothing else writes to the database here, and that is deliberate. The
  // mirror rows are upserted on the submission path, which is the moment the
  // foreign key actually requires one, so a deploy changes the schema and
  // nothing else — and rolling back to an older image does not rewrite the
  // mirror tables with older titles on the way down.

  // One loop, and it touches no network at all: four indexed statements
  // against columns this process owns. There is no slow backend to isolate it
  // from, so nothing here is worth splitting.
  //
  // Self-scheduling rather than `setInterval`, because a pass can outrun its
  // own interval and nothing would stop the next one starting anyway.
  const { startReaping } = await import("@/lib/runner/reaper");

  // Guarded so HMR reloads do not stack up loops during `next dev`.
  globalThis.__foiReaper?.();
  globalThis.__foiReaper = startReaping(REAP_INTERVAL_MS);

  // Forgets the addresses of people who started registering and stopped. Every
  // one is somebody's mailbox, and an abandoned attempt should not leave it in
  // the database.
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
