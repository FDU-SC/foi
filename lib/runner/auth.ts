import { listBackendIds } from "@/lib/backend/registry";
import { resolveBackend } from "@/lib/backend/resolve";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
  type SignedRequest,
} from "@/lib/backend/signature";

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

export function verifyRunner(
  backendId: string,
  request: Request,
  signed: SignedRequest,
): { ok: true } | { ok: false; reason: string } {
  let secret: string;
  try {
    secret = resolveBackend(backendId).secret;
  } catch {

    return { ok: false, reason: "签名不匹配" };
  }

  const { timestamp, signature } = headerPair(request);
  return verifySignature({ secret, timestamp, signature, request: signed });
}

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
