/**
 * Where each problem backend lives.
 *
 * A problem's `backend.id` selects an entry here. Adding a backend means
 * adding a key — the kernel neither knows nor cares what the service does with
 * the payload it forwards.
 *
 * "Backend" rather than "judge" because judging is one of the things these
 * services do, not the only one: the same process that grades a submission is
 * also the one that would hand out a container for the problem, and it has to
 * be, since a per-instance flag is only known to whoever created the instance.
 * The judging half of the protocol keeps the `judge` name throughout, because
 * that half really is about judging.
 */
export interface ProblemBackend {
  url: string;
  /**
   * Read from `FOI_BACKEND_<NAME>_SECRET`. Falls back to the shared
   * `FOI_BACKEND_SECRET` in `resolveBackend` when a backend has none.
   */
  secret?: string;
  /** Milliseconds to wait for the backend to acknowledge a dispatch. */
  timeoutMs?: number;
  /**
   * Milliseconds to wait on an interactive endpoint.
   *
   * Separate from `timeoutMs` because a dispatch is acknowledged and queued
   * while an action is answered: starting a container takes as long as it
   * takes. A backend that cannot answer quickly should return early with
   * something a poll action can follow up on, the same bargain judging makes.
   */
  actionTimeoutMs?: number;
  /**
   * Milliseconds a submission may go without a result before it is given up
   * on entirely.
   *
   * Per backend rather than one constant in the reconciler, because the two
   * ends of the range are nowhere near each other: the wait that means "this
   * verdict is lost" on a flag check is still an ordinary queue on a backend
   * that times a baseline. `resolveBackend` supplies the default for entries
   * that say nothing.
   */
  abandonAfterMs?: number;
}

/** The mock in `scripts/mock-backend.ts`, which `pnpm backend:mock` starts. */
const DEVELOPMENT_MOCK_URL = "http://localhost:4100";

/**
 * What an entry holds in production when nothing configured it.
 *
 * Never dispatched to in practice — `assertEnv` refuses a production boot on
 * exactly this condition, and it runs first thing in `instrumentation.ts`. A
 * value rather than a throw because these entries are built at import: a throw
 * here would surface at whichever request first pulled this file in, which is
 * the failure mode `lib/env.ts` exists to move back to boot time. `.invalid`
 * is reserved by RFC 2606 and resolves nowhere, so anything that does reach it
 * fails DNS and says why, instead of reaching a neighbour on :4100.
 */
const UNCONFIGURED_URL = "http://backend-url-not-configured.invalid";

/**
 * The `<NAME>` half of every address variable the entries below read.
 *
 * Collected as they are read rather than written out a second time for
 * `backendsMissingUrl`: a hand-kept list is how a backend added later becomes
 * the one entry nothing checks, which is the failure the check is there to
 * stop.
 */
const urlNames = new Set<string>();

/**
 * Reads the new name, then the old one, then decides what silence means.
 *
 * The legacy fallback exists so that renaming these variables did not have to
 * be synchronised with a deploy: a running environment still set only
 * `FOI_JUDGE_*` and would otherwise have lost every backend address at once.
 * Drop it once the deployed environments have been updated.
 *
 * A missing address used to mean `localhost:4100` everywhere, which made
 * forgetting one in a deployment free at boot and expensive afterwards:
 * dispatches go to whatever is listening on that port beside the app — nothing
 * — so no verdict ever arrives and the reconciler gives up on the submissions
 * one at a time, ten minutes each. That is word for word the reason
 * `lib/env.ts` gives for holding `FOI_PUBLIC_URL` mandatory, and it is the
 * same failure, so the default it was defending against is worse than the
 * missing value. The mock is a development convenience only; in production
 * `assertEnv` refuses the boot instead.
 */
function backendUrl(name: string): string {
  urlNames.add(name);

  // Empty reads as absent, here and in `backendsMissingUrl`: a line left as
  // `FOI_BACKEND_X_URL=` is somebody who has not filled it in yet, and taking
  // it for an address is the one way past the boot check.
  const configured =
    process.env[`FOI_BACKEND_${name}_URL`] ||
    process.env[`FOI_JUDGE_${name}_URL`];
  if (configured) return configured;

  return process.env.NODE_ENV === "production"
    ? UNCONFIGURED_URL
    : DEVELOPMENT_MOCK_URL;
}

/**
 * Entries with no address anywhere in `env`, named by the variable to set.
 *
 * Answered here rather than assembled in `lib/env.ts`, because both the naming
 * convention and the pre-rename spelling live in this file: a second reader of
 * them is a second thing to update when the legacy fallback above is finally
 * deleted, and a stale copy would start refusing deployments that are
 * configured correctly.
 *
 * Takes the environment instead of reading `process.env`, so the boot check
 * judges backends against the same record it judges everything else against.
 */
export function backendsMissingUrl(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const missing = [...urlNames].filter(
    (name) => !env[`FOI_BACKEND_${name}_URL`] && !env[`FOI_JUDGE_${name}_URL`],
  );

  return missing.map((name) => `FOI_BACKEND_${name}_URL`);
}

/**
 * A backend's own signing key, when it has been given one.
 *
 * One shared key means one compromised backend can sign as any of the others,
 * and `app/api/judge/callback/route.ts` was already written for the world
 * where that is not so: it sweeps every configured secret to decide whether a
 * caller holds *some* backend's key, then re-checks against the key belonging
 * to the backend the submission was actually dispatched to. That second check
 * is a no-op while everything shares one value. Filling this in is what turns
 * it back on.
 *
 * Undefined rather than falling back to the shared key here. The difference
 * between "has its own" and "borrowing everyone's" is exactly what
 * `backendSecretWarnings()` reports on, and collapsing it at this layer would
 * leave nothing able to tell the two apart. The fallback stays in
 * `resolveBackend`, which is where it already was.
 *
 * Empty is undefined, so that every reader of these variables agrees on what
 * counts as a key: an `.env` carrying an unfilled `FOI_BACKEND_X_SECRET=` is
 * somebody who has not filled it in yet, and `backendSecretWarnings` already
 * read the blank line as "no key of its own". `resolveBackend` reaches for the
 * shared key with `||` for the same reason. It used to use `??`, which kept
 * the `""` — a value, so no fallback — and then found it falsy a line later
 * and refused to resolve the backend at all, naming the very variable that was
 * set.
 */
function backendSecret(name: string): string | undefined {
  return process.env[`FOI_BACKEND_${name}_SECRET`] || undefined;
}

export const backends: Record<string, ProblemBackend> = {
  traditional: {
    url: backendUrl("TRADITIONAL"),
    secret: backendSecret("TRADITIONAL"),
  },
  "flag-checker": {
    url: backendUrl("FLAG_CHECKER"),
    secret: backendSecret("FLAG_CHECKER"),
  },
  "output-only": {
    url: backendUrl("OUTPUT_ONLY"),
    secret: backendSecret("OUTPUT_ONLY"),
  },
  interactive: {
    url: backendUrl("INTERACTIVE"),
    secret: backendSecret("INTERACTIVE"),
  },
  performance: {
    url: backendUrl("PERFORMANCE"),
    secret: backendSecret("PERFORMANCE"),
    // Counted from submission, so it covers the queue as well as the run, and
    // a timed problem cannot share a machine with anything else without
    // changing the number being measured — so the queue here is a serial one.
    // `perf-optimize` alone is a warmup plus three timed runs at an 8s limit,
    // against a baseline the backend runs the same way, and one machine
    // grading a room's worth of those is still working long after the
    // ten-minute default has declared every one of them lost.
    abandonAfterMs: 30 * 60 * 1000,
  },
  roulette: {
    url: backendUrl("ROULETTE") ?? "http://localhost:4100",
    secret: backendSecret("ROULETTE"),
  },
  // Its own entry rather than a shared checker, because it also orchestrates
  // the containers whose flags it verifies. See its `problem.ts`.
  "leaky-bucket": {
    url: backendUrl("LEAKY_BUCKET"),
    secret: backendSecret("LEAKY_BUCKET"),
    // Pulling an image the first time takes longer than acknowledging a
    // dispatch ever does.
    actionTimeoutMs: 30_000,
  },
};
