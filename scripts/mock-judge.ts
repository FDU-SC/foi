import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  sign,
  verifySignature,
} from "../lib/judge/signature";
import type { JudgeQueue, QueueItem, Verdict } from "../lib/judge/types";

const PORT = Number(process.env.MOCK_JUDGE_PORT ?? 4100);
const JUDGE_DELAY_MS = Number(process.env.MOCK_JUDGE_DELAY ?? 1500);
/** Concurrent evaluation slots; anything beyond this waits in the queue. */
const CAPACITY = Number(process.env.MOCK_JUDGE_CAPACITY ?? 2);
const VERSION = "1.0.0";

/** `--drop-callbacks` judges normally but never reports, to exercise the reconciler. */
const DROP_CALLBACKS = process.argv.includes("--drop-callbacks");

const secret = process.env.FOI_JUDGE_SECRET;
if (!secret) throw new Error("缺少环境变量 FOI_JUDGE_SECRET");

const startedAt = Date.now();

interface JudgeRequestBody {
  submissionId: string;
  problem: { slug: string; config?: unknown };
  payload: unknown;
  callbackUrl: string;
  callbackToken: string;
}

interface Job {
  judgeRef: string;
  request: JudgeRequestBody;
  verdict: Verdict;
  state: "pending" | "running" | "done";
  enqueuedAt: number;
  startedAt?: number;
}

/**
 * The judge owns its queue. FOI dispatches immediately and never throttles,
 * so accepting a submission means taking responsibility for scheduling it —
 * a real judge would bound concurrency the same way to avoid thrashing the
 * sandbox host.
 */
const jobs = new Map<string, Job>();
const waiting: string[] = [];
let running = 0;
let completed = 0;
/** Accumulated evaluation wall time, used to report a mean back to FOI. */
let totalDurationMs = 0;

function pump(): void {
  while (running < CAPACITY && waiting.length > 0) {
    const judgeRef = waiting.shift();
    if (!judgeRef) break;
    const job = jobs.get(judgeRef);
    if (!job || job.state !== "pending") continue;

    job.state = "running";
    job.startedAt = Date.now();
    running += 1;
    console.log(
      `  开始评测 ${job.request.submissionId} (占用 ${running}/${CAPACITY}，待处理 ${waiting.length})`,
    );

    setTimeout(() => void finish(job), JUDGE_DELAY_MS);
  }
}

async function finish(job: Job): Promise<void> {
  job.state = "done";
  running -= 1;
  completed += 1;
  totalDurationMs += Date.now() - (job.startedAt ?? job.enqueuedAt);

  if (!DROP_CALLBACKS) await sendCallback(job.request, job.verdict);
  pump();
}

function enqueue(request: JudgeRequestBody, verdict: Verdict): string {
  const judgeRef = randomUUID();
  jobs.set(judgeRef, {
    judgeRef,
    request,
    verdict,
    state: "pending",
    enqueuedAt: Date.now(),
  });
  waiting.push(judgeRef);
  console.log(
    `收到 ${request.submissionId} (${request.problem.slug}) -> ${judgeRef}，入队第 ${waiting.length} 位`,
  );
  pump();
  return judgeRef;
}

function snapshot(): JudgeQueue {
  const items: QueueItem[] = [];
  for (const job of jobs.values()) {
    if (job.state === "done") continue;
    items.push({
      submissionId: job.request.submissionId,
      problemSlug: job.request.problem.slug,
      state: job.state,
      enqueuedAt: new Date(job.enqueuedAt).toISOString(),
      startedAt: job.startedAt
        ? new Date(job.startedAt).toISOString()
        : undefined,
    });
  }
  items.sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));

  return {
    health: waiting.length > 0 ? "busy" : "ok",
    capacity: CAPACITY,
    running,
    pending: waiting.length,
    completed,
    avgDurationMs:
      completed > 0 ? Math.round(totalDurationMs / completed) : undefined,
    items,
    version: VERSION,
    uptimeMs: Date.now() - startedAt,
  };
}

function judgeCode(config: unknown, payload: unknown): Verdict {
  const source = String((payload as { source?: unknown })?.source ?? "");
  const subtasks =
    (config as { subtasks?: { name: string; score: number }[] })?.subtasks ?? [
      { name: "全部数据", score: 100 },
    ];

  // Stand-in for real evaluation: a solution that mentions a queue is treated
  // as the intended BFS, anything non-empty gets partial credit.
  const looksCorrect = /queue|bfs|deque/i.test(source);
  const hasContent = source.trim().length > 0;

  let score = 0;
  const tests = subtasks.map((subtask, index) => {
    const pass = looksCorrect || (hasContent && index === 0);
    if (pass) score += subtask.score;
    return {
      name: subtask.name,
      status: pass ? "accepted" : "wrong_answer",
      score: pass ? subtask.score : 0,
      maxScore: subtask.score,
      time: 20 + Math.floor(Math.random() * 180),
      memory: 2048 + Math.floor(Math.random() * 8192),
    };
  });

  const maxScore = subtasks.reduce((sum, s) => sum + s.score, 0);
  return {
    status:
      score === maxScore ? "accepted" : score > 0 ? "partial" : "wrong_answer",
    score,
    maxScore,
    detail: {
      tests,
      message: hasContent ? undefined : "提交内容为空",
    },
  };
}

function judgeFlag(config: unknown, payload: unknown): Verdict {
  const cfg = config as { expected?: string; caseSensitive?: boolean };
  const submitted = String((payload as { flag?: unknown })?.flag ?? "");
  const expected = cfg?.expected ?? "";

  const correct =
    cfg?.caseSensitive === false
      ? submitted.toLowerCase() === expected.toLowerCase()
      : submitted === expected;

  return {
    status: correct ? "accepted" : "wrong_answer",
    score: correct ? 300 : 0,
    maxScore: 300,
    detail: { message: correct ? "flag 正确" : "flag 不正确" },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function sendCallback(body: JudgeRequestBody, verdict: Verdict) {
  const payload = JSON.stringify({
    submissionId: body.submissionId,
    callbackToken: body.callbackToken,
    ...verdict,
  });
  const timestamp = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(body.callbackUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: String(timestamp),
        [SIGNATURE_HEADER]: sign(secret!, timestamp, payload),
      },
      body: payload,
    });
    console.log(
      `  回调 ${body.submissionId} -> ${res.status} (${verdict.status} ${verdict.score}/${verdict.maxScore})`,
    );
  } catch (error) {
    console.error(`  回调失败 ${body.submissionId}`, error);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const raw = await readBody(req);

  const check = verifySignature({
    secret: secret!,
    timestamp: (req.headers[TIMESTAMP_HEADER] as string | undefined) ?? null,
    signature: (req.headers[SIGNATURE_HEADER] as string | undefined) ?? null,
    body: raw,
  });

  if (!check.ok) {
    console.warn(
      `  拒绝未签名请求 ${req.method} ${url.pathname}: ${check.reason}`,
    );
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: check.reason }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/judge") {
    const body = JSON.parse(raw) as JudgeRequestBody;
    const verdict =
      (body.problem.config as { mode?: string })?.mode === "static" ||
      (body.payload as { flag?: string })?.flag !== undefined
        ? judgeFlag(body.problem.config, body.payload)
        : judgeCode(body.problem.config, body.payload);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ accepted: true, judgeRef: enqueue(body, verdict) }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/queue") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(snapshot()));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/status/")) {
    const ref = decodeURIComponent(url.pathname.slice("/status/".length));
    const job = jobs.get(ref);
    const done = job?.state === "done";
    console.log(`  状态查询 ${ref} -> ${done ? "done" : (job?.state ?? "未知")}`);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(done ? { done, verdict: job.verdict } : { done: false }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`mock 判题机监听 :${PORT}`);
  console.log(`  并发容量 ${CAPACITY}，单题耗时 ${JUDGE_DELAY_MS}ms`);
  if (DROP_CALLBACKS) console.log("  已开启丢弃回调模式，用于验证对账兜底");
});
