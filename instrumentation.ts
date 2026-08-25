declare global {
  var __foiReaper: ReturnType<typeof setTimeout> | undefined;
  var __foiVerificationSweep: ReturnType<typeof setInterval> | undefined;
}

/**
 * How often the queue is swept for jobs nobody is looking after.
 *
 * Well under `HEARTBEAT_LAPSE_MS`, so the delay between a runner going quiet
 * and its work being handed to somebody else is dominated by the lapse itself
 * rather than by when this happens to fire. A pass is three indexed statements
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
  const { assertEnv } = await import("@/lib/env");
  assertEnv();

  // Same argument, one variable `assertEnv` cannot judge on its own: whether a
  // missing `FOI_SMTP_HOST` is fatal depends on what `content/enrollment/`
  // declared, and `lib/env.ts` deliberately knows nothing about content — the
  // same split `backendSecretWarnings` below is on the other side of. Without
  // this, a production deployment that forgot its relay boots happily and then
  // prints every verification code and reset link to the container log while
  // telling people the mail is on its way.
  const { assertMailDelivery } = await import("@/lib/mail/transport");
  assertMailDelivery();

  // Third refusal, and the newest. A backend's signing key used to authenticate
  // us *to* it — outbound, from a server we control. It now authenticates a
  // runner *to us*, from whatever machine happens to be running one, and it
  // buys its holder the whole of that backend's queue: every competitor's
  // source, a free hand with verdicts, and the ability to burn attempts until
  // submissions read as disrupted. Two backends on one key means compromising
  // the softer of them yields all of that for both.
  //
  // This was a warning for as long as the exposure was ours. Now that it is not,
  // production says no — the fix is one environment variable per service, and a
  // deployment that has not done it should find out before a contest rather
  // than after one. Beside `assertEnv` rather than inside it because knowing
  // which backends carry traffic means reading the problem registry, and
  // `lib/env.ts` deliberately knows nothing about content.
  //
  // Its neighbour is the half of the old address check that survived. Judging
  // needs no address, so `lib/env.ts` no longer demands one for every entry;
  // what still cannot work without one is a backend some problem declares an
  // interactive action on, because those the kernel does have to dial.
  const { assertBackendActionUrls, assertBackendSecrets } = await import(
    "@/lib/backend/access"
  );
  assertBackendSecrets();
  assertBackendActionUrls();

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
  // Alongside `assertEnv` rather than inside it: which backends are in use is
  // derived from the problem registry, and `lib/env.ts` deliberately knows
  // nothing about content. Said here, where the rest of the "your
  // configuration is legal but probably not what you meant" checks are said.
  const { backendSecretWarnings } = await import("@/lib/backend/access");
  for (const warning of [
    ...enrollmentWarnings(),
    ...contestWarnings(),
    ...problemGateWarnings(),
    ...backendSecretWarnings(),
  ]) {
    console.warn(`[foi] ${warning}`);
  }

  // One loop where there were two, and the two were a consequence of the queue
  // living somewhere else. A poller asked every backend what it was holding and
  // a verifier reasoned about what that answer left out; both existed to infer,
  // across a network, a fact the kernel now simply has. Neither had anything to
  // do once nobody was dispatching.
  //
  // What is left touches no network at all: three indexed statements against
  // columns this process owns. So there is no slow backend to isolate a loop
  // from, and nothing left worth splitting.
  //
  // Self-scheduling rather than `setInterval`, because a pass can outrun its
  // own interval and nothing stops the next one starting anyway — which is how
  // the original reconciler ended up with dozens of passes in flight.
  const { startReaping } = await import("@/lib/runner/reaper");

  // Guarded so HMR reloads do not stack up timers during `next dev`.
  clearTimeout(globalThis.__foiReaper);
  globalThis.__foiReaper = startReaping(REAP_INTERVAL_MS);

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
