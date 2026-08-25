import { and, asc, count, gte, inArray } from "drizzle-orm";
import { backends, type ProblemBackend } from "@/backends.config";
import type { Viewer } from "@/lib/auth/viewer";
import { readTextBody } from "@/lib/body-limit";
import { db } from "@/lib/db";
import { runners, submissions } from "@/lib/db/schema";
import { backendsFor } from "./access";
import { signedHeaders } from "./signature";
import { type BackendActionRequest } from "./types";

/**
 * How long an interactive endpoint may take to reply.
 *
 * One number, and it is now the only timeout in the file. Dispatch and status
 * polling had their own until the direction reversed and both endpoints went
 * away; what is left is the half a backend cannot pull, and the protocol
 * already says what it owes: answer promptly and let a `poll` action follow up.
 * A backend that cannot answer a cheap question inside ten seconds is one
 * `/judges` should be showing as unhealthy.
 */
const DEFAULT_REPLY_TIMEOUT_MS = 10_000;

/**
 * How much of a backend's answer this process will hold.
 *
 * The timeout bounds how long a backend can keep the kernel waiting; nothing
 * bounded how much it could make the kernel buffer, and `res.text()` reads to
 * completion — so one backend answering with an endless body took the app down
 * with it.
 *
 * Generous, because an action response is the problem's to define. A backend
 * that needs more than this is not returning a message, it is returning a file,
 * and that wants a URL rather than a relay.
 */
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface ResolvedBackend extends ProblemBackend {
  id: string;
  secret: string;
  replyTimeoutMs: number;
}

/**
 * A backend's key and, where it has one, its address.
 *
 * The key is what every request in either direction is signed with, so this is
 * reached for on both paths now: the kernel calling an action outward, and a
 * runner's claim being checked inward. The address is only needed by the first
 * of those — see `url` in `backends.config.ts`.
 */
export function resolveBackend(id: string): ResolvedBackend {
  const entry = backends[id];
  if (!entry) {
    throw new Error(`未知的题目后端 "${id}"，请检查 backends.config.ts`);
  }

  // Old name accepted as a fallback for the same reason the URLs are; see
  // `backends.config.ts`.
  //
  // `||` and not `??`, because the test below is `!secret` and the two have to
  // agree on what counts as a key. An `.env` carrying an unfilled
  // `FOI_BACKEND_SECRET=` hands this `""`: a value, so `??` kept it, and then
  // falsy, so the throw fired — naming the very variable that was set. Every
  // reader of these now treats blank as absent, `backendSecret` in
  // `backends.config.ts` included.
  const secret =
    entry.secret ||
    process.env.FOI_BACKEND_SECRET ||
    process.env.FOI_JUDGE_SECRET;
  if (!secret) {
    throw new Error("缺少环境变量 FOI_BACKEND_SECRET");
  }

  return {
    ...entry,
    id,
    secret,
    replyTimeoutMs: entry.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS,
  };
}

/**
 * The commit this process was built from, recorded on every submission.
 *
 * Baked in by the Dockerfile from a build arg the CI supplies. Null outside
 * that path — a local `next dev` or a hand-built image did not come from a
 * commit, and saying so is better than inventing a value. Deliberately absent
 * from `assertEnv`: a deployment without it works fine, it just cannot answer
 * "which code judged this" later.
 */
export function releaseSha(): string | null {
  return process.env.FOI_RELEASE_SHA || null;
}

/**
 * One place where a request to a backend is turned into a URL and its headers.
 *
 * The signature covers the path, so the path that gets signed has to be the
 * path that gets sent — resolved against the backend's base URL rather than
 * taken from the relative string, since a base URL carrying a path prefix
 * would otherwise sign one thing and request another.
 *
 * Throws on a backend with no address, which is now reachable configuration
 * rather than an impossibility: only backends a problem declares an action on
 * need one. `actionFor` has already established that this problem declared this
 * action, so getting here without an address means the deployment is running an
 * interactive problem it has not finished configuring, and saying which
 * variable is missing is more use than a fetch to `undefined`.
 */
function signedRequest(
  backend: ResolvedBackend,
  method: string,
  path: string,
  body: string,
): { url: URL; headers: Record<string, string> } {
  if (!backend.url) {
    throw new Error(
      `题目后端 "${backend.id}" 声明了交互动作但没有地址，请设置 FOI_BACKEND_${envFragment(backend.id)}_URL`,
    );
  }

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

/** `leaky-bucket` → `LEAKY_BUCKET`, the spelling `backends.config.ts` reads. */
function envFragment(id: string): string {
  return id.replace(/-/g, "_").toUpperCase();
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
      signal: AbortSignal.timeout(backend.replyTimeoutMs),
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

  const read = await readTextBody(res, MAX_RESPONSE_BYTES);
  if (!read.ok) {
    // 502 rather than the backend's own status: the exchange did not complete,
    // and a component told "200, here is nothing" would render an empty
    // container as a working one.
    return {
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "题目后端响应过大" }),
    };
  }

  return {
    status: res.status,
    contentType: relayableContentType(res.headers.get("content-type")),
    body: read.text,
  };
}

export function listBackendIds(): string[] {
  return Object.keys(backends);
}

/**
 * How recently a runner must have asked for work to count as here.
 *
 * Several times the poll interval the protocol suggests, because a runner that
 * misses one poll to a network hiccup has not gone anywhere and a board that
 * flickers is one nobody reads. What it has to catch is a runner that has
 * stopped, and that shows up within a minute.
 */
const RUNNER_ONLINE_MS = 60_000;

/** One entry in a backend's queue, as the board draws it. */
export interface QueueEntry {
  submissionId: string;
  /**
   * Absent once redacted for non-admins: it would reveal which problem each
   * person is working on, mid-contest.
   */
  problemSlug?: string;
  state: "queued" | "judging";
  /**
   * The holder's own account of what it is doing, verbatim, or null. Opaque —
   * see `runnerStatusSchema`. Redacted alongside `runnerId`, because a problem
   * is perfectly capable of writing its own name into it.
   */
  status?: string | null;
  runnerId?: string | null;
  enqueuedAt: string;
  claimedAt?: string;
}

/**
 * What one backend's queue looks like right now.
 *
 * A database read rather than a report from the backend, and that is the whole
 * change: the queue is here, so positions are exact rather than a snapshot of
 * whatever a judge said fifteen seconds ago, and nothing has to be reachable to
 * be shown.
 *
 * `health`, `capacity`, `latencyMs` and `online` all went with it. Every one of
 * them was a backend describing itself over a link that had to be up for the
 * description to arrive, which meant the board's answer to "is this working"
 * was mostly an answer about the network. `runners` replaces the lot: it is the
 * number of processes that have actually asked for work lately, which is the
 * only fact an operator needs beside the queue depth to tell a backlog apart
 * from an outage.
 */
export interface BackendQueueStatus {
  id: string;
  /**
   * Where the kernel reaches this backend for interactive actions, or null —
   * both when the viewer may not see it and when the backend has none, which is
   * now the ordinary case. Judging needs no address at all.
   */
  url: string | null;
  runners: number;
  queued: number;
  judging: number;
  items: QueueEntry[];
}

/** Rows drawn per backend. A board, not an export. */
const BOARD_LIMIT = 50;

/**
 * Every configured backend's queue, from the database.
 *
 * Driven by the configuration rather than by what happens to be in the table,
 * so a backend with nothing queued still appears — as an idle one, which is
 * information.
 */
async function allBackendQueues(): Promise<BackendQueueStatus[]> {
  const ids = listBackendIds();
  if (ids.length === 0) return [];

  const since = new Date(Date.now() - RUNNER_ONLINE_MS);

  const [rows, online] = await Promise.all([
    db
      .select({
        id: submissions.id,
        backendId: submissions.backendId,
        problemSlug: submissions.problemSlug,
        state: submissions.state,
        runnerId: submissions.runnerId,
        runnerStatus: submissions.runnerStatus,
        createdAt: submissions.createdAt,
        claimedAt: submissions.claimedAt,
      })
      .from(submissions)
      .where(
        and(
          inArray(submissions.backendId, ids),
          inArray(submissions.state, ["queued", "judging"]),
        ),
      )
      .orderBy(asc(submissions.createdAt))
      .limit(BOARD_LIMIT * ids.length),
    db
      .select({ backendId: runners.backendId, count: count() })
      .from(runners)
      .where(
        and(
          inArray(runners.backendId, ids),
          gte(runners.lastSeenAt, since),
        ),
      )
      .groupBy(runners.backendId),
  ]);

  const runnersById = new Map(online.map((row) => [row.backendId, row.count]));

  return ids.map((id) => {
    const mine = rows.filter((row) => row.backendId === id);
    return {
      id,
      url: backends[id]?.url ?? null,
      runners: runnersById.get(id) ?? 0,
      queued: mine.filter((row) => row.state === "queued").length,
      judging: mine.filter((row) => row.state === "judging").length,
      items: mine.slice(0, BOARD_LIMIT).map((row) => ({
        submissionId: row.id,
        problemSlug: row.problemSlug,
        state: row.state === "judging" ? "judging" : "queued",
        status: row.runnerStatus,
        runnerId: row.runnerId,
        enqueuedAt: row.createdAt.toISOString(),
        claimedAt: row.claimedAt?.toISOString(),
      })),
    };
  });
}

/**
 * The queues this viewer may see, already redacted for them.
 *
 * Two decisions that used to be made separately at two call sites — the page
 * and the API each fetched every queue and then chose how much to blank out,
 * and neither asked whether the viewer should know the backend existed at all.
 * Both ask here.
 */
export async function judgeQueuesFor(
  viewer: Viewer,
): Promise<BackendQueueStatus[]> {
  const allowed = new Set(backendsFor(viewer));
  const statuses = (await allBackendQueues()).filter((status) =>
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
 * position off the queue. Removed: the backend's address, which is
 * infrastructure detail that only widens the attack surface; other players'
 * problem choices, which leak who is working on what mid-contest; and the
 * runner's name and self-description, because both are strings a backend
 * author chose and neither is anything a competitor is owed.
 */
export function redactJudgeStatus(
  status: BackendQueueStatus,
): BackendQueueStatus {
  return {
    ...status,
    url: null,
    items: status.items.map(
      ({
        problemSlug: _problemSlug,
        status: _status,
        runnerId: _runnerId,
        ...rest
      }) => rest,
    ),
  };
}

