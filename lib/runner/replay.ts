import { MAX_CLOCK_SKEW_SECONDS } from "@/lib/backend/signature";

/**
 * Nonces already spent, so a captured claim cannot be posted twice.
 *
 * The signature covers a timestamp, which bounds *how long* a captured pair of
 * headers stays valid but not *how many times* it may be used inside that
 * window. That is harmless on the two endpoints keyed to a job — a report names
 * an id and a lease, and the lease is gone after the first one lands — and it
 * is not harmless on the claim, whose body is `{backendId, runnerId, nonce}`
 * against a constant path. Without the nonce the signing input for a claim is
 * the same every second, so one captured request could be replayed to drain a
 * queue: each POST takes the next job, no heartbeat follows, ninety seconds
 * later the row is requeued with an attempt spent, and three of those land it
 * in `disrupted`.
 *
 * Only the claim gets this. See the README's 「领取」 section, and note what a
 * nonce costs a runner: one more random string per request.
 */

/**
 * How long a spent nonce is remembered.
 *
 * Twice the skew, not once, and the factor of two is the whole of the
 * arithmetic. A request is accepted when `|now - timestamp| <= skew`, so a
 * runner whose clock runs fast by the full allowance sends `timestamp = now +
 * skew` — and that same signature keeps verifying until `now + 2 * skew`.
 * Remembering the nonce for only one skew would forget it while the signature
 * it protects is still good, which is a gap in exactly the shape this exists
 * to close.
 *
 * There is no need to go beyond it: past this point `verifySignature` refuses
 * the request on the timestamp alone, so the two windows close together and a
 * longer memory would only hold entries that can no longer be used.
 */
export const REPLAY_TTL_MS = 2 * MAX_CLOCK_SKEW_SECONDS * 1000;

export interface ReplayWindow {
  /**
   * Records this nonce and answers whether it had not been used before. False
   * means a repeat, and the caller must refuse the request.
   */
  firstUse(backendId: string, nonce: string): boolean;
  /** Live key count. Exposed for tests and for the eviction assertions. */
  size(): number;
}

export interface ReplayWindowOptions {
  /**
   * Hard ceiling on nonces held at once.
   *
   * The same reasoning as `maxKeys` in `lib/ratelimit/window.ts` — the key
   * space is chosen by the caller, so without a ceiling the number of entries
   * is somebody else's to decide — with one difference in each direction.
   *
   * Smaller threat: the caller here has already proved it holds a backend's
   * signing key, because the route checks the signature *before* it reaches
   * this map. An outsider cannot write a single entry. That ordering is what
   * keeps the defence from becoming a new exhaustion surface, and it is the
   * reason this bound is a backstop rather than the front line.
   *
   * Worse failure: evicting a rate-limit bucket hands somebody a few extra
   * requests, while evicting a nonce lets a replay through. So the ceiling is
   * set where a real fleet cannot reach it — a runner polling once a second
   * holds about `REPLAY_TTL_MS / 1s` entries per queue, so ten minutes of
   * memory is roughly 600 per runner per backend, and this deployment's four
   * backends would need dozens of runner processes each to come near.
   */
  maxKeys: number;
  /** Defaults to `REPLAY_TTL_MS`; a parameter so tests can shorten it. */
  ttlMs?: number;
}

export function createReplayWindow(options: ReplayWindowOptions): ReplayWindow {
  const ttlMs = options.ttlMs ?? REPLAY_TTL_MS;

  /** Key to the moment it may be forgotten. */
  const spent = new Map<string, number>();

  function evict(now: number): void {
    for (const [key, expiresAt] of spent) {
      if (expiresAt <= now) spent.delete(key);
    }

    if (spent.size < options.maxKeys) return;

    // Still full after dropping what has expired. Shed the entries nearest
    // their own expiry, which are the ones a replay has least time left to
    // exploit.
    const byExpiry = [...spent.entries()].sort((a, b) => a[1] - b[1]);
    const excess = spent.size - options.maxKeys + 1;
    for (let i = 0; i < excess; i += 1) spent.delete(byExpiry[i][0]);
  }

  return {
    firstUse(backendId, nonce) {
      const now = Date.now();

      // Scoped per backend, so two runners serving different queues cannot
      // spend each other's nonces. Nothing is lost by the narrower key: the
      // body is signed, so a captured claim for one backend cannot be re-aimed
      // at another without breaking the signature that admitted it.
      const key = `${backendId}:${nonce}`;

      const expiresAt = spent.get(key);
      if (expiresAt !== undefined && expiresAt > now) return false;

      if (spent.size >= options.maxKeys) evict(now);
      spent.set(key, now + ttlMs);
      return true;
    },

    size: () => spent.size,
  };
}

declare global {
  var __foiClaimNonces: ReplayWindow | undefined;
}

/**
 * The window the claim endpoint uses.
 *
 * On `globalThis` for the reason the rate limiter is: Next can place a module
 * in more than one server bundle, and a per-bundle copy of this would let the
 * same nonce be spent once in each.
 *
 * In memory and therefore per process, the same assumption the rate limiter
 * and the submission event bus already make. A second app process would have
 * its own window and would accept a nonce the first one had spent — worth
 * knowing, and no worse than the state before this existed. Moving it to
 * Postgres belongs with the same move for those two.
 */
export const claimNonces: ReplayWindow = (globalThis.__foiClaimNonces ??=
  createReplayWindow({ maxKeys: 50_000 }));
