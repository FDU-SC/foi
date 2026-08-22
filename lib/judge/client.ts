import { createHash, randomBytes } from "node:crypto";
import { judges, type JudgeEndpoint } from "@/judges.config";
import { signedHeaders } from "./signature";
import {
  judgeQueueSchema,
  judgeStatusSchema,
  type JudgeQueue,
  type JudgeRequest,
  type Verdict,
} from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ResolvedJudge extends JudgeEndpoint {
  id: string;
  secret: string;
  timeoutMs: number;
}

export function resolveJudge(id: string): ResolvedJudge {
  const entry = judges[id];
  if (!entry) {
    throw new Error(`未知的判题机 "${id}"，请检查 judges.config.ts`);
  }

  const secret = entry.secret ?? process.env.FOI_JUDGE_SECRET;
  if (!secret) {
    throw new Error("缺少环境变量 FOI_JUDGE_SECRET");
  }

  return {
    ...entry,
    id,
    secret,
    timeoutMs: entry.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

export function callbackUrl(): string {
  const base = process.env.FOI_PUBLIC_URL;
  if (!base) throw new Error("缺少环境变量 FOI_PUBLIC_URL");
  return new URL("/api/judge/callback", base).toString();
}

/**
 * Callback tokens are high-entropy random values, so a plain SHA-256 digest is
 * enough — there is nothing to brute-force the way there is with a password.
 */
export function createCallbackToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashCallbackToken(token) };
}

export function hashCallbackToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Hands a submission to its judge. Only the acknowledgement is awaited; the
 * result arrives later via callback (or via the reconciler, if it is lost).
 */
export async function dispatchToJudge(
  judge: ResolvedJudge,
  request: JudgeRequest,
): Promise<{ judgeRef: string | null }> {
  const body = JSON.stringify(request);
  const res = await fetch(new URL("/judge", judge.url), {
    method: "POST",
    headers: signedHeaders(judge.secret, body),
    body,
    signal: AbortSignal.timeout(judge.timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`判题机返回 ${res.status}: ${await safeText(res)}`);
  }

  const data = (await res.json().catch(() => null)) as {
    judgeRef?: unknown;
  } | null;

  return {
    judgeRef: typeof data?.judgeRef === "string" ? data.judgeRef : null,
  };
}

export function listJudgeIds(): string[] {
  return Object.keys(judges);
}

export interface JudgeQueueStatus {
  id: string;
  /** Null once redacted for non-admins. */
  url: string | null;
  online: boolean;
  latencyMs: number | null;
  error: string | null;
  queue: JudgeQueue | null;
}

/**
 * What a player is allowed to see.
 *
 * Submission ids stay, so everyone can find their own entry and read their
 * position off the queue. The judge's address and other players' problem
 * choices are removed: the former is infrastructure detail that only widens
 * the attack surface, the latter leaks who is working on what mid-contest.
 */
export function redactJudgeStatus(status: JudgeQueueStatus): JudgeQueueStatus {
  return {
    ...status,
    url: null,
    queue: status.queue
      ? {
          ...status.queue,
          items: status.queue.items.map(
            ({ problemSlug: _problemSlug, ...rest }) => rest,
          ),
        }
      : null,
  };
}

/** Kept short: this drives a status page that polls, not a submission path. */
const QUEUE_TIMEOUT_MS = 3_000;

/**
 * Reads one judge's internal queue.
 *
 * Signed like every other judge call, which is also why the browser cannot
 * query judges directly — the shared secret must not leave the server.
 */
export async function fetchJudgeQueue(
  judgeId: string,
): Promise<JudgeQueueStatus> {
  const base: JudgeQueueStatus = {
    id: judgeId,
    url: judges[judgeId]?.url ?? "",
    online: false,
    latencyMs: null,
    error: null,
    queue: null,
  };

  let judge: ResolvedJudge;
  try {
    judge = resolveJudge(judgeId);
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "判题机配置错误",
    };
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(new URL("/queue", judge.url), {
      method: "GET",
      headers: signedHeaders(judge.secret, ""),
      signal: AbortSignal.timeout(QUEUE_TIMEOUT_MS),
      cache: "no-store",
    });

    const latencyMs = Date.now() - startedAt;
    if (!res.ok) {
      return { ...base, latencyMs, error: `返回 ${res.status}` };
    }

    const parsed = judgeQueueSchema.safeParse(await res.json());
    if (!parsed.success) {
      return { ...base, latencyMs, error: "队列响应格式不合法" };
    }

    return { ...base, online: true, latencyMs, queue: parsed.data };
  } catch (error) {
    return {
      ...base,
      latencyMs: Date.now() - startedAt,
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "连接超时"
          : "无法连接",
    };
  }
}

export function fetchAllJudgeQueues(): Promise<JudgeQueueStatus[]> {
  return Promise.all(listJudgeIds().map(fetchJudgeQueue));
}

/** Asks a judge directly whether a submission finished. Used by the reconciler. */
export async function pollJudge(
  judge: ResolvedJudge,
  judgeRef: string,
): Promise<{ done: boolean; verdict?: Verdict } | null> {
  const path = `/status/${encodeURIComponent(judgeRef)}`;
  const res = await fetch(new URL(path, judge.url), {
    method: "GET",
    headers: signedHeaders(judge.secret, ""),
    signal: AbortSignal.timeout(judge.timeoutMs),
  });

  if (!res.ok) return null;

  const parsed = judgeStatusSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

async function safeText(res: Response): Promise<string> {
  return (await res.text().catch(() => "")).slice(0, 200);
}
