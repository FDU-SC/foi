declare global {
  var __foiReconciler: ReturnType<typeof setInterval> | undefined;
  var __foiAccountSweep: ReturnType<typeof setInterval> | undefined;
}

const RECONCILE_INTERVAL_MS = 15_000;
const ACCOUNT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export async function register() {
  // The registry is Turbopack-built and Node-only; skip other runtimes.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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

  // Registries are the source of truth; the mirror tables exist only so
  // submissions can carry foreign keys. Pushing them here means a deploy is
  // consistent before it serves a single request. Grants come along for the
  // same reason: the bootstrap administrator needs a row before anything can
  // reference it, and nobody can create one through the UI.
  const { syncProblems } = await import("@/lib/problems/sync");
  const { syncContests } = await import("@/lib/contests/queries");
  const { syncGrants } = await import("@/lib/accounts/sync");
  const [problems, contests, grants] = await Promise.all([
    syncProblems(),
    syncContests(),
    syncGrants(),
  ]);
  console.log(
    `[foi] 已同步 ${problems.synced} 道题目、${contests.synced} 场比赛、${grants.synced} 个声明账号`,
  );

  // Enrollment misconfigurations — nobody able to administer, no cohort rules,
  // a contest whose tag nothing produces — are said loudly rather than
  // refusing to boot: the CLI can still recover the deployment, and an outage
  // would be the worse failure. Some of these used to fail the build, back
  // when what they referred to was code rather than data.
  const { enrollmentWarnings } = await import("@/lib/enrollment/registry");
  const { contestWarnings } = await import("@/lib/contests/registry");
  for (const warning of [...enrollmentWarnings(), ...contestWarnings()]) {
    console.warn(`[foi] ${warning}`);
  }

  const { reconcileStaleSubmissions } = await import("@/lib/judge/reconciler");

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

  // A signup that never confirmed its address is holding a handle nobody can
  // use. Releasing it on a timer is what keeps a typo from being permanent —
  // the person just registers again — and stops the handle space filling with
  // abandoned claims.
  const { purgeUnverifiedAccounts } = await import("@/lib/accounts/queries");
  const { enrollmentPolicy } = await import("@/lib/enrollment/registry");

  const sweep = () => {
    const cutoff = new Date(
      Date.now() - enrollmentPolicy.unverifiedTtlHours * 60 * 60 * 1000,
    );
    void purgeUnverifiedAccounts(cutoff)
      .then((handles) => {
        if (handles.length > 0) {
          console.log(`[foi] 已回收 ${handles.length} 个未验证的用户名`);
        }
      })
      .catch((error) => console.error("[foi] 回收未验证账号失败", error));
  };

  clearInterval(globalThis.__foiAccountSweep);
  globalThis.__foiAccountSweep = setInterval(sweep, ACCOUNT_SWEEP_INTERVAL_MS);
  sweep();
}
