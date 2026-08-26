import type { ProblemBackend } from "./types";

/**
 * How a backend id is spelled in the environment.
 *
 * Separate from `./types.ts`, which holds the `ProblemBackend` shape, because
 * everything here reads `process.env` and that module is reachable from a
 * client component — `verdict-badge.tsx` imports `STATE_PRESETS` from it. A
 * type costs nothing to put there; an environment read cannot go there at all.
 */

/**
 * Where an unconfigured backend points outside production, when a deployment
 * says where that is.
 *
 * The kernel used to hold the address itself — `http://localhost:4100`, with a
 * comment naming the script that listens there. That is one repository's
 * development mock written into the platform: a checkout whose reference
 * runner is a container on another port, or which has none, got an address for
 * a service that was never going to answer, and no way to say so short of
 * setting `FOI_BACKEND_<每一个>_URL` by hand.
 *
 * Unset means unset. `backendUrl` then answers `undefined` outside production
 * exactly as it does inside it, which is the honest reading of a deployment
 * that has not said where its backends are.
 */
function developmentFallbackUrl(): string | undefined {
  return process.env.FOI_DEV_BACKEND_URL || undefined;
}

/**
 * A backend id as it appears in an environment variable: hyphens become
 * underscores and the whole thing goes uppercase.
 *
 * One function so that the name a deployment sets and the name a boot check
 * reports cannot drift apart. Every message naming a variable derives it from
 * here.
 */
export function envFragment(id: string): string {
  return id.replace(/-/g, "_").toUpperCase();
}

/**
 * Reads the variable, then decides what silence means.
 *
 * Silence is `undefined` rather than an unroutable placeholder. A placeholder
 * existed because every backend needed an address and a missing one had to
 * fail loudly at the point of use; almost none of them need one any more, so
 * "not configured" and "not needed" are the same state and there is nothing to
 * distinguish. Which backends genuinely require an address is a question about
 * the problem registry — see `backendsMissingActionUrl` in `./access.ts`.
 *
 * There used to be a second name read here, `FOI_JUDGE_<NAME>_URL`, kept so
 * that renaming these variables did not have to be synchronised with a deploy.
 * It has outlived that: the environments were updated, and what remained was
 * the kernel carrying one deployment's rename history and offering every
 * reader two spellings to check.
 */
export function backendUrl(id: string): string | undefined {
  // Empty reads as absent: a line left as `FOI_BACKEND_X_URL=` is somebody who
  // has not filled it in yet, and taking it for an address is the one way past
  // the boot check.
  const configured = process.env[`FOI_BACKEND_${envFragment(id)}_URL`];
  if (configured) return configured;

  return process.env.NODE_ENV === "production"
    ? undefined
    : developmentFallbackUrl();
}

/**
 * A backend's own signing key, when it has been given one.
 *
 * One shared key means one compromised backend can sign as any of the others,
 * and what that now buys has grown teeth: a runner authenticates *inbound* with
 * this, so holding it drains that backend's queue, reads every submission in it
 * and writes whatever verdicts it likes. Sharing one across backends makes all
 * of that transitive. Production refuses to boot on it — see
 * `assertBackendSecrets` in `./access.ts`.
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
export function backendSecret(id: string): string | undefined {
  return process.env[`FOI_BACKEND_${envFragment(id)}_SECRET`] || undefined;
}

/**
 * A backend configured entirely by convention, which is nearly all of them.
 *
 * Spread it to override one field: `{ ...fromEnv("slow"), replyTimeoutMs: 30000 }`.
 */
export function fromEnv(id: string): ProblemBackend {
  return { url: backendUrl(id), secret: backendSecret(id) };
}
