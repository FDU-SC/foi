import { listBackendIds } from "@/lib/backend/registry";
import { resolveBackend } from "@/lib/backend/resolve";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
  type SignedRequest,
} from "@/lib/backend/signature";

/**
 * Who is asking, on the three endpoints runners use.
 *
 * The credential is the same HMAC the kernel has always used against backends,
 * pointed the other way: a runner signs with the key of the backend it is
 * running for, and holding that key is what entitles it to that backend's work.
 * Nothing else here authorises anything — `runnerId` is a label, and the lease
 * on a job answers a different question (who currently holds this row) that
 * `lib/runner/queue.ts` deals with.
 *
 * One of these keys lets its holder drain a queue, read every competitor's
 * source and write verdicts, from whatever machine runs a runner — which is
 * why production refuses to boot on a shared one. See `assertBackendSecrets`
 * in `lib/backend/boot.ts`.
 */

/**
 * The path a signature covers, which is not necessarily the path the request
 * arrived on.
 *
 * A reverse proxy that strips a prefix — `location /foi/ { proxy_pass
 * http://app/; }` — leaves the runner signing one path and this process
 * verifying another, and every report fails for a reason nothing in the logs
 * explains. So both sides agree on the kernel's own spelling instead: a runner
 * takes `new URL(path, base).pathname`, which discards any prefix in its base
 * URL, and gets exactly these strings.
 */
export const CLAIM_PATH = "/api/runner/jobs/request";

export function jobPath(id: string): string {
  return `/api/runner/jobs/${encodeURIComponent(id)}`;
}

function headerPair(request: Request): {
  timestamp: string | null;
  signature: string | null;
} {
  return {
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  };
}

/**
 * Whether this request was signed with one named backend's key.
 *
 * Named rather than inferred, because inference is ambiguous exactly when it
 * matters: several entries in `content/backends.ts` may legitimately hold the
 * same key when one runner deployment serves them all, and a sweep would then
 * hand the caller whichever entry it happened to try first. A claim says which
 * queue it wants and this checks it may have it; a report is checked against
 * the backend its own row names.
 */
export function verifyRunner(
  backendId: string,
  request: Request,
  signed: SignedRequest,
): { ok: true } | { ok: false; reason: string } {
  let secret: string;
  try {
    secret = resolveBackend(backendId).secret;
  } catch {
    // Indistinguishable from a bad signature on purpose. Answering "no such
    // backend" would let anyone enumerate `content/backends.ts` from outside.
    return { ok: false, reason: "签名不匹配" };
  }

  const { timestamp, signature } = headerPair(request);
  return verifySignature({ secret, timestamp, signature, request: signed });
}

/**
 * Whether *some* configured backend signed this.
 *
 * Used for one decision only: whether a request about an unknown submission id
 * deserves a plain 404 or the same 401 a forged request gets. A caller that has
 * proved it holds a key is an operator with a misconfigured runner and should
 * be told what is actually wrong; a caller that has not must not be able to use
 * this endpoint to find out which submission ids exist. Single-digit HMACs, and
 * only on the path where the row was not found.
 */
export function signedByAnyBackend(
  request: Request,
  signed: SignedRequest,
): boolean {
  const { timestamp, signature } = headerPair(request);

  return listBackendIds().some((id) => {
    let secret: string;
    try {
      secret = resolveBackend(id).secret;
    } catch {
      return false;
    }
    return verifySignature({ secret, timestamp, signature, request: signed }).ok;
  });
}
