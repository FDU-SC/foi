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
 * The kernel holds no address of its own here. Writing one in — this
 * repository's mock listens on `:4100` — hands a checkout whose reference
 * runner is elsewhere, or absent, an address for a service that will never
 * answer, with no way to say so short of setting `FOI_BACKEND_<每一个>_URL` by
 * hand.
 *
 * Unset means unset. `backendUrl` then answers `undefined` outside production
 * exactly as it does inside it.
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
 * Silence is `undefined` rather than an unroutable placeholder: almost no
 * backend needs an address, so "not configured" and "not needed" are the same
 * state and there is nothing for a placeholder to distinguish. Which backends
 * genuinely require one is a question about the problem registry — see
 * `backendsMissingActionUrl` in `./boot.ts`.
 *
 * Only `FOI_BACKEND_<NAME>_URL` is read. There is no second, older spelling.
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
 * `assertBackendSecrets` in `./boot.ts`.
 *
 * Undefined rather than falling back to the shared key here. The difference
 * between "has its own" and "borrowing everyone's" is exactly what that check
 * reports on, and collapsing it at this layer would leave nothing able to tell
 * the two apart. The fallback is `sharedSecret` below, applied by
 * `effectiveSecret` in `./resolve.ts`.
 *
 * Empty is undefined, so that every reader of these variables agrees on what
 * counts as a key: an `.env` carrying an unfilled `FOI_BACKEND_X_SECRET=` is
 * somebody who has not filled it in yet, and `backendsSharingSecret` reads the
 * blank line as "no key of its own". `effectiveSecret` reaches for the shared
 * key with `||` for the same reason — `??` would keep the `""`, which is a
 * value and so takes no fallback, then find it falsy a line later and refuse
 * to resolve the backend at all, naming the very variable that was set.
 */
export function backendSecret(id: string): string | undefined {
  return process.env[`FOI_BACKEND_${envFragment(id)}_SECRET`] || undefined;
}

/**
 * The key a backend signs with when it has been given none of its own.
 *
 * `FOI_JUDGE_SECRET` is the pre-rename spelling and is still read, here and in
 * `withLegacyNames` in `lib/env.ts` — the two have to agree, because a
 * deployment carrying only the old name would otherwise pass the boot check
 * and then fail every submission at `resolveBackend`. It is not read for the
 * per-backend variables: `FOI_JUDGE_<NAME>_URL` and `FOI_JUDGE_<NAME>_SECRET`
 * really are gone, and only this one shared name survives the rename.
 *
 * `||` and the trailing `undefined` so that a blank line in an `.env` reads as
 * absent here too — the same rule `backendSecret` above applies, and every
 * reader of these variables now agrees with it.
 */
export function sharedSecret(): string | undefined {
  return (
    process.env.FOI_BACKEND_SECRET || process.env.FOI_JUDGE_SECRET || undefined
  );
}

/**
 * The commit this process was built from, recorded on every submission.
 *
 * Baked in by the Dockerfile from a build arg the CI supplies. Null outside
 * that path — a local `next dev` or a hand-built image did not come from a
 * commit, and saying so is better than inventing a value. Deliberately absent
 * from `assertEnv`: a deployment without it works fine, it just cannot answer
 * "which code judged this" later.
 */
export function releaseSha(): string | null {
  return process.env.FOI_RELEASE_SHA || null;
}

/**
 * A backend configured entirely by convention, which is nearly all of them.
 *
 * Spread it to override one field: `{ ...fromEnv("slow"), replyTimeoutMs: 30000 }`.
 */
export function fromEnv(id: string): ProblemBackend {
  return { url: backendUrl(id), secret: backendSecret(id) };
}
