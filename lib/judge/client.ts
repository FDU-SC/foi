import { createHash, randomBytes } from "node:crypto";
import { judges, type JudgeEndpoint } from "@/judges.config";
import type { Viewer } from "@/lib/auth/viewer";
import { judgesFor } from "./access";
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
 * Why a dispatch produced no acknowledgement.
 *
 * The distinction decides whether the submission is finished or merely
 * unaccounted for. `rejected` means the judge answered and refused: it will
 * never evaluate this submission, so the row can go terminal immediately.
 * `unknown` means we never got an answer worth trusting — a timeout, a dropped
 * connection, a 5xx. The judge may have queued the submission regardless, so
 * the row has to stay non-terminal and let the reconciler settle it. Calling
 * that case `failed` would be worse than saying nothing: the eventual callback
 * would arrive to find a terminal row and discard a real verdict.
 */
export type DispatchFailure = "rejected" | "unknown";

export class DispatchError extends Error {
  readonly kind: DispatchFailure;

  constructor(message: string, kind: DispatchFailure) {
    super(message);
    this.name = "DispatchError";
    this.kind = kind;
  }
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

  let res: Response;
  try {
    res = await fetch(new URL("/judge", judge.url), {
      method: "POST",
      headers: signedHeaders(judge.secret, body),
      body,
      signal: AbortSignal.timeout(judge.timeoutMs),
    });
  } catch (error) {
    // The request may well have arrived and been queued; we just never saw
    // the reply. Nothing here says the submission is dead.
    throw new DispatchError(
      error instanceof Error && error.name === "TimeoutError"
        ? "投递判题机超时，结果未知"
        : "无法连接判题机，结果未知",
      "unknown",
    );
  }

  if (!res.ok) {
    // 4xx is the judge saying it will not take this submission. 5xx is the
    // judge falling over, which says nothing about whether it queued first.
    throw new DispatchError(
      `判题机返回 ${res.status}: ${await safeText(res)}`,
      res.status < 500 ? "rejected" : "unknown",
    );
  }

  const data = (await res.json().catch(() => null)) as {
    accepted?: unknown;
    judgeRef?: unknown;
  } | null;

  // The protocol has judges answer `{ accepted: true, judgeRef }`. An explicit
  // `false` is the one way a 2xx still means "this will never be judged".
  if (data?.accepted === false) {
    throw new DispatchError("判题机拒绝接收该提交", "rejected");
  }

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
 * The judges this viewer may see, already redacted for them.
 *
 * Two decisions that used to be made separately at two call sites — the page
 * and the API each fetched every judge and then chose how much to blank out,
 * and neither asked whether the viewer should know the judge existed at all.
 * Both now ask here.
 */
export async function judgeQueuesFor(
  viewer: Viewer,
): Promise<JudgeQueueStatus[]> {
  const allowed = new Set(judgesFor(viewer));
  const statuses = (await fetchAllJudgeQueues()).filter((status) =>
    allowed.has(status.id),
  );

  return viewer.can("judge.inspect")
    ? statuses
    : statuses.map(redactJudgeStatus);
}

/**
 * What a player is allowed to see of a judge they may see at all.
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

declare global {
  var __foiQueueSnapshot:
    | { value: Promise<JudgeQueueStatus[]>; expiresAt: number }
    | undefined;
}

/**
 * How long one sweep of the judges is reused.
 *
 * Short enough that the queue board still reads as live, long enough to
 * collapse a contest's worth of concurrent readers into one request per judge.
 */
const QUEUE_SNAPSHOT_TTL_MS = 1_000;

/**
 * Every judge's queue, at most once per second per process.
 *
 * This is on the hot path twice over. `/judges` polls it every four seconds
 * per viewer, and every poll of an unfinished submission calls it too — with
 * the client backing off from 800ms, a hundred players waiting on a verdict
 * meant hundreds of outbound requests per second, one per judge per poll. The
 * load arrived precisely when the judges were already saturated, which is when
 * players watch the queue.
 *
 * The promise is cached rather than its result, so callers arriving during a
 * sweep join it instead of starting another. A rejected sweep is not possible
 * here — `fetchJudgeQueue` reports failure as a value — but the entry is
 * dropped on rejection anyway so a future refactor cannot pin a failure for a
 * full second.
 */
export function fetchAllJudgeQueues(): Promise<JudgeQueueStatus[]> {
  const cached = globalThis.__foiQueueSnapshot;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = Promise.all(listJudgeIds().map(fetchJudgeQueue));
  const entry = { value, expiresAt: Date.now() + QUEUE_SNAPSHOT_TTL_MS };
  globalThis.__foiQueueSnapshot = entry;

  value.catch(() => {
    if (globalThis.__foiQueueSnapshot === entry) {
      globalThis.__foiQueueSnapshot = undefined;
    }
  });

  return value;
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
