declare global {
  var __foiReconciler: ReturnType<typeof setInterval> | undefined;
  var __foiVerificationSweep: ReturnType<typeof setInterval> | undefined;
}

const RECONCILE_INTERVAL_MS = 15_000;
const VERIFICATION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export async function register() {
  // The registry is Turbopack-built and Node-only; skip other runtimes.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // First, and for the same reason the migration below aborts startup: a
  // deployment that cannot work should say so while the health check is still
  // watching, rather than at whichever request first needs the missing value.
  const { assertEnv } = await import("@/lib/env");
  assertEnv();

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

  // Nothing else writes to the database here, and that is deliberate.
  //
  // Startup used to push the whole problem and contest registry into their
  // mirror tables and materialise the declared accounts. None of it was
  // needed: `ensureProblem` and `ensureContest` upsert on the submission path,
  // which is the moment the foreign key actually requires a row, and accounts
  // now come from registration or from `scripts/create-account.cjs`. What the
  // sync bought was a mirror row for problems nobody had submitted to, whose
  // only consumer was a drift finding reporting that the sync had not run yet.
  //
  // A deploy therefore changes the schema and nothing else. That is worth
  // having on its own: rolling back to an older image no longer rewrites the
  // mirror tables with older titles on the way down.

  // Enrollment misconfigurations — nobody able to administer, no cohort rules,
  // a contest whose tag nothing produces — are said loudly rather than
  // refusing to boot: the CLI can still recover the deployment, and an outage
  // would be the worse failure. Some of these used to fail the build, back
  // when what they referred to was code rather than data.
  const { enrollmentWarnings } = await import("@/lib/enrollment/registry");
  const { contestWarnings } = await import("@/lib/contests/registry");
  const { problemGateWarnings } = await import("@/lib/problems/access");
  for (const warning of [
    ...enrollmentWarnings(),
    ...contestWarnings(),
    ...problemGateWarnings(),
  ]) {
    console.warn(`[foi] ${warning}`);
  }

  const { reconcileStaleSubmissions } = await import("@/lib/backend/reconciler");

  // Guarded so HMR reloads do not stack up timers during `next dev`.
  clearInterval(globalThis.__foiReconciler);
  globalThis.__foiReconciler = setInterval(() => {
    void reconcileStaleSubmissions()
      .then(({ resolved, abandoned }) => {
        if (resolved || abandoned) {
          console.log(`[foi] 对账: 补齐 ${resolved} 条，超时 ${abandoned} 条`);
        }
      })
      .catch((error) => console.error("[foi] 对账失败", error));
  }, RECONCILE_INTERVAL_MS);

  // This slot used to release handles held by signups that never confirmed
  // their address. There are no such signups any more — an account is not
  // created until the code has been typed back — so what is left to forget is
  // the addresses of people who started and stopped. Every one is somebody's
  // mailbox, and an abandoned attempt should not leave it in the database.
  const { purgeExpiredVerifications } = await import(
    "@/lib/auth/email-verification"
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
