import { createHash, randomBytes } from "node:crypto";
import { backends, type ProblemBackend } from "@/backends.config";
import type { Viewer } from "@/lib/auth/viewer";
import { backendsFor } from "./access";
import { signedHeaders } from "./signature";
import {
  judgeQueueSchema,
  judgeStatusSchema,
  type BackendActionRequest,
  type JudgeQueue,
  type JudgeRequest,
  type Verdict,
} from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

/** Longer than a dispatch: an action is answered, not merely acknowledged. */
const DEFAULT_ACTION_TIMEOUT_MS = 20_000;

export interface ResolvedBackend extends ProblemBackend {
  id: string;
  secret: string;
  timeoutMs: number;
  actionTimeoutMs: number;
}

export function resolveBackend(id: string): ResolvedBackend {
  const entry = backends[id];
  if (!entry) {
    throw new Error(`未知的题目后端 "${id}"，请检查 backends.config.ts`);
  }

  // Old name accepted as a fallback for the same reason the URLs are; see
  // `backends.config.ts`.
  const secret =
    entry.secret ??
    process.env.FOI_BACKEND_SECRET ??
    process.env.FOI_JUDGE_SECRET;
  if (!secret) {
    throw new Error("缺少环境变量 FOI_BACKEND_SECRET");
  }

  return {
    ...entry,
    id,
    secret,
    timeoutMs: entry.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    actionTimeoutMs: entry.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
  };
}

export function callbackUrl(): string {
  const base = process.env.FOI_PUBLIC_URL;
  if (!base) throw new Error("缺少环境变量 FOI_PUBLIC_URL");
  return new URL("/api/judge/callback", base).toString();
}

/**
 * One place where a request to a backend is turned into a URL and its headers.
 *
 * The signature covers the path, so the path that gets signed has to be the
 * path that gets sent — resolved against the backend's base URL rather than
 * taken from the relative string, since a base URL carrying a path prefix
 * would otherwise sign one thing and request another. Every outbound call goes
 * through here so that pairing cannot come apart at one of four call sites.
 */
function signedRequest(
  backend: ResolvedBackend,
  method: string,
  path: string,
  body: string,
): { url: URL; headers: Record<string, string> } {
  const url = new URL(path, backend.url);
  return {
    url,
    headers: signedHeaders(backend.secret, {
      method,
      path: url.pathname + url.search,
      body,
    }),
  };
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
 * unaccounted for. `rejected` means the backend answered and refused: it will
 * never evaluate this submission, so the row can go terminal immediately.
 * `unknown` means we never got an answer worth trusting — a timeout, a dropped
 * connection, a 5xx. The backend may have queued the submission regardless, so
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
 * Hands a submission to its backend for judging. Only the acknowledgement is awaited; the
 * result arrives later via callback (or via the reconciler, if it is lost).
 */
export async function dispatchToJudge(
  backend: ResolvedBackend,
  request: JudgeRequest,
): Promise<{ judgeRef: string | null }> {
  const body = JSON.stringify(request);
  const { url, headers } = signedRequest(backend, "POST", "/judge", body);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(backend.timeoutMs),
    });
  } catch (error) {
    // The request may well have arrived and been queued; we just never saw
    // the reply. Nothing here says the submission is dead.
    throw new DispatchError(
      error instanceof Error && error.name === "TimeoutError"
        ? "投递题目后端超时，结果未知"
        : "无法连接题目后端，结果未知",
      "unknown",
    );
  }

  if (!res.ok) {
    // 4xx is the backend saying it will not take this submission. 5xx is it
    // falling over, which says nothing about whether it queued first.
    throw new DispatchError(
      `题目后端返回 ${res.status}: ${await safeText(res)}`,
      res.status < 500 ? "rejected" : "unknown",
    );
  }

  const data = (await res.json().catch(() => null)) as {
    accepted?: unknown;
    judgeRef?: unknown;
  } | null;

  // The protocol has a backend answer `{ accepted: true, judgeRef }`. An explicit
  // `false` is the one way a 2xx still means "this will never be judged".
  if (data?.accepted === false) {
    throw new DispatchError("题目后端拒绝接收该提交", "rejected");
  }

  return {
    judgeRef: typeof data?.judgeRef === "string" ? data.judgeRef : null,
  };
}

/** What came back from an interactive endpoint, for relaying verbatim. */
export interface BackendActionResponse {
  status: number;
  contentType: string;
  body: string;
}

/**
 * Media types an action response may be relayed as.
 *
 * The body stays opaque to the kernel — that is the whole bargain of these
 * endpoints. The header telling a browser how to interpret it is a different
 * thing, and passing the backend's own through meant a backend could answer
 * `text/html` and have the kernel serve it from the platform's origin. The
 * components that consume these endpoints call `res.json()`, so nothing renders
 * it today; the URL is reachable directly, so a link to it would.
 *
 * That is now a smaller worry than it was, since signing the path means the
 * response has to come from the action the kernel actually invoked. It is still
 * worth closing: a compromised backend is exactly the case where the kernel
 * should not be lending out its origin.
 *
 * A whitelist rather than a blacklist, because the set of things a problem's
 * component needs is small and known, while the set of types a browser will
 * execute is neither.
 */
const RELAYABLE_CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "application/octet-stream",
] as const;

/**
 * The declared type when it is one we relay, `application/octet-stream`
 * otherwise.
 *
 * Downgraded rather than refused. An action answering with something
 * unexpected is the problem author's to fix, and turning it into a 502 here
 * would break a working feature over a header — whereas serving the same bytes
 * under a type no browser renders costs the author nothing.
 */
function relayableContentType(header: string | null): string {
  if (!header) return "application/json";

  // Matched on the type alone; the parameters ride along, since `charset` is
  // the caller's business and only the type decides how a browser treats it.
  const type = header.split(";")[0].trim().toLowerCase();
  return (RELAYABLE_CONTENT_TYPES as readonly string[]).includes(type)
    ? header
    : "application/octet-stream";
}

/**
 * Invokes one interactive endpoint and hands the answer back untouched.
 *
 * Nothing here inspects the response. The kernel knows that `spawn` is a
 * string a problem declared and that whoever asked was allowed to; what comes
 * back belongs to the statement's own component, exactly as a verdict's
 * `detail` belongs to the problem rather than to the submission list.
 *
 * An unreachable backend becomes 503 rather than an exception, because the
 * caller's job is to relay a status code and a component showing "backend
 * unavailable" is more use to a player than a 500.
 */
export async function callBackendAction(
  backend: ResolvedBackend,
  request: BackendActionRequest,
): Promise<BackendActionResponse> {
  const body = JSON.stringify(request);
  const { url, headers } = signedRequest(
    backend,
    "POST",
    `/action/${encodeURIComponent(request.action)}`,
    body,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(backend.actionTimeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: timedOut ? "题目后端响应超时" : "无法连接题目后端",
      }),
    };
  }

  return {
    status: res.status,
    contentType: relayableContentType(res.headers.get("content-type")),
    body: await res.text(),
  };
}

export function listBackendIds(): string[] {
  return Object.keys(backends);
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
 * The judging queues this viewer may see, already redacted for them.
 *
 * Two decisions that used to be made separately at two call sites — the page
 * and the API each fetched every queue and then chose how much to blank out,
 * and neither asked whether the viewer should know the backend existed at all.
 * Both now ask here.
 */
export async function judgeQueuesFor(
  viewer: Viewer,
): Promise<JudgeQueueStatus[]> {
  const allowed = new Set(backendsFor(viewer));
  const statuses = (await fetchAllJudgeQueues()).filter((status) =>
    allowed.has(status.id),
  );

  return viewer.can("backend.inspect")
    ? statuses
    : statuses.map(redactJudgeStatus);
}

/**
 * What a player is allowed to see of a queue they may see at all.
 *
 * Submission ids stay, so everyone can find their own entry and read their
 * position off the queue. The backend's address and other players' problem
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
 * Reads one backend's internal judging queue.
 *
 * Signed like every other backend call, which is also why the browser cannot
 * query backends directly — the shared secret must not leave the server.
 */
export async function fetchJudgeQueue(
  backendId: string,
): Promise<JudgeQueueStatus> {
  const base: JudgeQueueStatus = {
    id: backendId,
    url: backends[backendId]?.url ?? "",
    online: false,
    latencyMs: null,
    error: null,
    queue: null,
  };

  let backend: ResolvedBackend;
  try {
    backend = resolveBackend(backendId);
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "题目后端配置错误",
    };
  }

  const startedAt = Date.now();
  try {
    const { url, headers } = signedRequest(backend, "GET", "/queue", "");
    const res = await fetch(url, {
      method: "GET",
      headers,
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
 * How long one sweep of the backends is reused.
 *
 * Short enough that the queue board still reads as live, long enough to
 * collapse a contest's worth of concurrent readers into one request each.
 */
const QUEUE_SNAPSHOT_TTL_MS = 1_000;

/**
 * Every backend's judging queue, at most once per second per process.
 *
 * This is on the hot path twice over. `/judges` polls it every four seconds
 * per viewer, and every poll of an unfinished submission calls it too — with
 * the client backing off from 800ms, a hundred players waiting on a verdict
 * meant hundreds of outbound requests per second, one per backend per poll. The
 * load arrived precisely when the backends were already saturated, which is when
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

  const value = Promise.all(listBackendIds().map(fetchJudgeQueue));
  const entry = { value, expiresAt: Date.now() + QUEUE_SNAPSHOT_TTL_MS };
  globalThis.__foiQueueSnapshot = entry;

  value.catch(() => {
    if (globalThis.__foiQueueSnapshot === entry) {
      globalThis.__foiQueueSnapshot = undefined;
    }
  });

  return value;
}

/** Asks a backend directly whether a submission finished. Used by the reconciler. */
export async function pollJudge(
  backend: ResolvedBackend,
  judgeRef: string,
): Promise<{ done: boolean; verdict?: Verdict } | null> {
  const { url, headers } = signedRequest(
    backend,
    "GET",
    `/status/${encodeURIComponent(judgeRef)}`,
    "",
  );
  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(backend.timeoutMs),
  });

  if (!res.ok) return null;

  const parsed = judgeStatusSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

async function safeText(res: Response): Promise<string> {
  return (await res.text().catch(() => "")).slice(0, 200);
}
