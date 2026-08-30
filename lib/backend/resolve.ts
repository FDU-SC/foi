import { backends } from "./registry";
import { envFragment, sharedSecret } from "./env";
import { type ProblemBackend } from "./types";

const DEFAULT_REPLY_TIMEOUT_MS = 10_000;

export interface ResolvedBackend extends ProblemBackend {
  id: string;
  secret: string;
  replyTimeoutMs: number;
}

export function effectiveSecret(id: string): string | undefined {
  return backends[id]?.secret || sharedSecret();
}

export function resolveBackend(id: string): ResolvedBackend {
  const entry = backends[id];
  if (!entry) {
    throw new Error(`未知的题目后端 "${id}"，请检查 content/backends.ts`);
  }

  const secret = effectiveSecret(id);
  if (!secret) {
    throw new Error(
      `题目后端 "${id}" 没有签名密钥，` +
        `请设置 FOI_BACKEND_${envFragment(id)}_SECRET 或 FOI_BACKEND_SECRET`,
    );
  }

  return {
    ...entry,
    id,
    secret,
    replyTimeoutMs: entry.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS,
  };
}
