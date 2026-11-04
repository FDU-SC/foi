import { backends } from "./registry";
import { masterSecret } from "./env";
import { deriveBackendSecret } from "./keys.cjs";
import { type ProblemBackend } from "./types";

const DEFAULT_REPLY_TIMEOUT_MS = 10_000;

export interface ResolvedBackend extends ProblemBackend {
  id: string;
  secret: string;
  replyTimeoutMs: number;
}

export function resolveBackend(id: string): ResolvedBackend {
  const entry = backends[id];
  if (!entry) {
    throw new Error(`未知的题目后端 "${id}"`);
  }

  const master = masterSecret();
  if (!master) {
    throw new Error(`题目后端 "${id}" 没有签名密钥，请设置 FOI_BACKEND_SECRET`);
  }

  return {
    ...entry,
    id,
    secret: deriveBackendSecret(master, id),
    replyTimeoutMs: entry.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS,
  };
}
