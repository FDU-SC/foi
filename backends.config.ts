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
  /**
   * Where the kernel reaches this backend — and only for the half it still
   * initiates.
   *
   * Optional now, and for most backends absent. Judging is pulled: a runner
   * comes to `POST /api/runner/jobs/request`, so it needs to reach *us* and
   * nothing here needs to reach it. What is left going outward is
   * `POST /action/<name>`, which a player sets off synchronously and which
   * therefore cannot be pulled — so an address is needed by exactly those
   * backends that some problem declares an `actions` entry on.
   *
   * That is not a compromise held over from the old direction. A problem
   * handing out containers for a competitor to connect into needs that machine
   * reachable regardless of how judging works.
   */
  url?: string;
  /**
   * Read from `FOI_BACKEND_<NAME>_SECRET`. Falls back to the shared
   * `FOI_BACKEND_SECRET` in `resolveBackend` when a backend has none — outside
   * production, where `assertBackendSecrets` refuses the boot instead.
   */
  secret?: string;
  /**
   * Milliseconds to wait for a reply from an interactive endpoint.
   *
   * One knob, where there used to be three, and now with only one endpoint
   * left to apply to. `actionTimeoutMs` went because the protocol already
   * requires every action to answer promptly and let a `poll` action follow up.
   * `abandonAfterMs` went because it was never a property of the backend at
   * all: it had to cover both how long a problem takes to judge and how deep
   * the queue was. Its replacement is a heartbeat, which is a property of
   * neither and is one number for the whole deployment.
   *
   * Rarely worth setting. A backend that cannot answer a cheap question inside
   * ten seconds is one `/judges` should be showing as unhealthy.
   */
  replyTimeoutMs?: number;
}

/** The mock in `scripts/mock-backend.ts`, which `pnpm backend:mock` starts. */
const DEVELOPMENT_MOCK_URL = "http://localhost:4100";

/**
 * Reads the new name, then the old one, then decides what silence means.
 *
 * The legacy fallback exists so that renaming these variables did not have to
 * be synchronised with a deploy: a running environment still set only
 * `FOI_JUDGE_*` and would otherwise have lost every backend address at once.
 * Drop it once the deployed environments have been updated.
 *
 * Silence is now `undefined` rather than an unroutable placeholder, and the
 * placeholder is gone with it. It existed because every backend needed an
 * address and a missing one had to fail loudly at the point of use; almost none
 * of them need one any more, so "not configured" and "not needed" are the same
 * state and there is nothing to distinguish. Which backends genuinely require
 * an address is a question about the problem registry — see
 * `backendsMissingActionUrl` in `lib/backend/access.ts`.
 *
 * The development fallback stays, and only for development: it is what lets a
 * fresh checkout run `leaky-bucket`'s actions against `pnpm backend:mock`
 * without configuring anything.
 */
function backendUrl(name: string): string | undefined {
  // Empty reads as absent: a line left as `FOI_BACKEND_X_URL=` is somebody who
  // has not filled it in yet, and taking it for an address is the one way past
  // the boot check.
  const configured =
    process.env[`FOI_BACKEND_${name}_URL`] ||
    process.env[`FOI_JUDGE_${name}_URL`];
  if (configured) return configured;

  return process.env.NODE_ENV === "production"
    ? undefined
    : DEVELOPMENT_MOCK_URL;
}

/**
 * A backend's own signing key, when it has been given one.
 *
 * One shared key means one compromised backend can sign as any of the others,
 * and what that now buys has grown teeth: a runner authenticates *inbound* with
 * this, so holding it drains that backend's queue, reads every submission in it
 * and writes whatever verdicts it likes. Sharing one across backends makes all
 * of that transitive. Production refuses to boot on it — see
 * `assertBackendSecrets` in `lib/backend/access.ts`.
 *
 * Undefined rather than falling back to the shared key here. The difference
 * between "has its own" and "borrowing everyone's" is exactly what that check
 * reports on, and collapsing it at this layer would leave nothing able to tell
 * the two apart. The fallback stays in `resolveBackend`, which is where it
 * already was.
 *
 * Empty is undefined, so that every reader of these variables agrees on what
 * counts as a key: an `.env` carrying an unfilled `FOI_BACKEND_X_SECRET=` is
 * somebody who has not filled it in yet, and `backendsSharingSecret` already
 * read the blank line as "no key of its own". `resolveBackend` reaches for the
 * shared key with `||` for the same reason. It used to use `??`, which kept
 * the `""` — a value, so no fallback — and then found it falsy a line later
 * and refused to resolve the backend at all, naming the very variable that was
 * set.
 */
function backendSecret(name: string): string | undefined {
  return process.env[`FOI_BACKEND_${name}_SECRET`] || undefined;
}

/**
 * Only the problems that genuinely need a service are here.
 *
 * Three entries used to live alongside these and no longer do —
 * `flag-checker`, `output-only` and `roulette` — because none of them needed
 * anything this file provides. Judging them takes nothing the kernel does not
 * already hold: the submission, the problem's own config, and who submitted.
 * They are now inline judges in `content/problems/_shared/judge/`, and with
 * them went three URLs, three secrets and three deployments.
 *
 * The test for whether something belongs here is whether the judgement needs
 * **isolation** (it runs what the competitor submitted), **resources** (a time
 * or memory limit worth measuring), or **state the kernel does not hold** (a
 * container, a flag minted when that container was handed out). Every entry
 * below is here for one of those three reasons; anything else is inline.
 */
export const backends: Record<string, ProblemBackend> = {
  traditional: {
    url: backendUrl("TRADITIONAL"),
    secret: backendSecret("TRADITIONAL"),
  },
  interactive: {
    url: backendUrl("INTERACTIVE"),
    secret: backendSecret("INTERACTIVE"),
  },
  // A timed problem cannot share a machine with anything else without changing
  // the number being measured, so this queue is a serial one and it runs long:
  // `perf-optimize` alone is a warmup plus three timed runs at an 8s limit,
  // against a baseline judged the same way. That used to need a thirty-minute
  // `abandonAfterMs` here, because the kernel gave up on anything older than
  // ten. It needs nothing now: a runner heartbeating through a long evaluation
  // keeps its job for as long as it takes, and the kernel never has to know how
  // long that is.
  performance: {
    url: backendUrl("PERFORMANCE"),
    secret: backendSecret("PERFORMANCE"),
  },
  // The one entry that genuinely needs its address, and the reason `url`
  // survives at all. It hands out containers, so `spawn`/`poll`/`destroy` are
  // synchronous requests the kernel makes on a player's behalf — there is no
  // pulling those. Its own entry rather than a shared checker because it also
  // verifies the flags those containers mint; see its `problem.ts`.
  //
  // Two-phase, which is why ten seconds is enough: `spawn` returns straight
  // away and a `poll` action follows the container to ready.
  "leaky-bucket": {
    url: backendUrl("LEAKY_BUCKET"),
    secret: backendSecret("LEAKY_BUCKET"),
  },
};
