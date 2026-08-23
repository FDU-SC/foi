declare global {
  var __foiReconciler: ReturnType<typeof setInterval> | undefined;
}

const RECONCILE_INTERVAL_MS = 15_000;

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
  // consistent before it serves a single request.
  const { syncProblems } = await import("@/lib/problems/sync");
  const { syncContests } = await import("@/lib/contests/queries");
  const [problems, contests] = await Promise.all([
    syncProblems(),
    syncContests(),
  ]);
  console.log(
    `[foi] 已同步 ${problems.synced} 道题目、${contests.synced} 场比赛`,
  );

  // A roster with nobody in it, or with no administrator, is almost always a
  // misconfiguration. Say so loudly rather than refusing to boot: the CLI can
  // still recover the deployment, and an outage would be the worse failure.
  const { rosterWarnings } = await import("@/lib/roster/registry");
  for (const warning of rosterWarnings()) {
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
}
