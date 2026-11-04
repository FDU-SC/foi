import { backends } from "@/lib/backend/registry";
import { resolveBackend } from "@/lib/backend/resolve";
import {
  KEY_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
  type SignedRequest,
} from "@/lib/backend/signature";
import { acceptRunnerToken, isKeyId, tokenSecret } from "./tokens";

export const CLAIM_PATH = "/api/runner/jobs/request";

export function jobPath(id: string): string {
  return `/api/runner/jobs/${encodeURIComponent(id)}`;
}

type Verification = { ok: true } | { ok: false; reason: string };

const UNPROVEN: Verification = { ok: false, reason: "签名不匹配" };

function signingKey(backendId: string, keyId: string | null): string | undefined {
  if (keyId === null) {
    try {
      return resolveBackend(backendId).secret;
    } catch {
      return undefined;
    }
  }

  if (!backends[backendId] || !isKeyId(keyId)) return undefined;
  return tokenSecret(backendId, keyId);
}

/**
 * The signature is checked before the token table is read: a request that
 * cannot prove it holds the key costs no query and learns nothing about which
 * key ids exist.
 */
export async function verifyRunner(
  backendId: string,
  request: Request,
  signed: SignedRequest,
): Promise<Verification> {
  const keyId = request.headers.get(KEY_ID_HEADER);

  const secret = signingKey(backendId, keyId);
  if (!secret) return UNPROVEN;

  const verified = verifySignature({
    secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    request: signed,
  });
  if (!verified.ok || keyId === null) return verified;

  return (await acceptRunnerToken(backendId, keyId))
    ? verified
    : { ok: false, reason: "令牌已吊销或不存在" };
}
