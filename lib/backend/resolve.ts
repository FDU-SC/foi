import { backends } from "./registry";
import { sharedSecret } from "./env";
import { type ProblemBackend } from "./types";

/**
 * A declared backend id turned into the key and address the kernel uses.
 *
 * Separate from `./client.ts` because resolution is reached on both paths —
 * the kernel calling an action outward, and a runner's claim being checked
 * inward by `lib/runner/auth.ts` — and only the first involves HTTP at all.
 */

/**
 * How long an interactive endpoint may take to reply, and the only timeout
 * anywhere on this path. The protocol already says what an action owes:
 * answer promptly and let a `poll` action follow up.
 */
const DEFAULT_REPLY_TIMEOUT_MS = 10_000;

export interface ResolvedBackend extends ProblemBackend {
  id: string;
  secret: string;
  replyTimeoutMs: number;
}

/**
 * The key a backend actually signs with — its own, or the shared fallback.
 *
 * Exported because `backendsSharingSecret` has to reach the same answer, and
 * the difference only shows when the two chains disagree. Ask instead whether
 * an entry has a key of its own, and the one arrangement that is both
 * plausible and silent gets waved through: somebody fills in
 * `FOI_BACKEND_TRADITIONAL_SECRET` by copying the value out of
 * `FOI_BACKEND_SECRET` while the next backend along is still borrowing it.
 * Two backends signing with one value is exactly the state `./boot.ts` refuses
 * a production boot on, however each of them arrived at it.
 */
export function effectiveSecret(id: string): string | undefined {
  return backends[id]?.secret || sharedSecret();
}

/**
 * A backend's key and, where it has one, its address. The key signs every
 * request in either direction; the address is needed only outbound — see `url`
 * on `ProblemBackend`.
 */
export function resolveBackend(id: string): ResolvedBackend {
  const entry = backends[id];
  if (!entry) {
    throw new Error(`未知的题目后端 "${id}"，请检查 content/backends.ts`);
  }

  const secret = effectiveSecret(id)!;

  return {
    ...entry,
    id,
    secret,
    replyTimeoutMs: entry.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS,
  };
}
