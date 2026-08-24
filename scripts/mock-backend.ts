import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  sign,
  verifySignature,
} from "../lib/backend/signature";
import type { JudgeQueue, QueueItem, Verdict } from "../lib/backend/types";

const PORT = Number(process.env.MOCK_BACKEND_PORT ?? 4100);
const JUDGE_DELAY_MS = Number(process.env.MOCK_BACKEND_DELAY ?? 1500);
/** Concurrent evaluation slots; anything beyond this waits in the queue. */
const CAPACITY = Number(process.env.MOCK_BACKEND_CAPACITY ?? 2);
const VERSION = "1.0.0";

/** `--drop-callbacks` judges normally but never reports, to exercise the reconciler. */
const DROP_CALLBACKS = process.argv.includes("--drop-callbacks");

const secret =
  process.env.FOI_BACKEND_SECRET ?? process.env.FOI_JUDGE_SECRET;
if (!secret) throw new Error("缺少环境变量 FOI_BACKEND_SECRET");

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
  verdict: Verdict | null;
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

  // The verdict is computed here, inside the evaluation slot, because
  // interactive judging actually compiles and runs the submission.
  job.verdict = await evaluate(job.request);
  if (!DROP_CALLBACKS) await sendCallback(job.request, job.verdict);
  pump();
}

function enqueue(request: JudgeRequestBody): string {
  const judgeRef = randomUUID();
  jobs.set(judgeRef, {
    judgeRef,
    request,
    verdict: null,
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

interface OutputCase {
  name?: string;
  expected?: string;
}

/**
 * Output-only judging: the submission is one text containing every scene's
 * answer, one per line, compared against `config.cases` in order. A real
 * judge would read the expected outputs from testdata instead of the config;
 * the shape of the comparison is what matters here.
 */
function judgeOutputOnly(config: unknown, payload: unknown): Verdict {
  const cases = ((config as { cases?: OutputCase[] })?.cases ?? []).filter(
    (c) => c.expected !== undefined,
  );
  const submitted = String((payload as { text?: unknown })?.text ?? "").trim();
  const lines = submitted.split(/\r?\n/).map((line) => line.trim());

  if (cases.length === 0) {
    return {
      status: "system_error",
      score: 0,
      maxScore: 100,
      detail: { message: "判题机配置缺少 cases" },
    };
  }

  const perCase = 100 / cases.length;
  let score = 0;
  const tests = cases.map((testCase, index) => {
    const pass = lines[index] === (testCase.expected ?? "").trim();
    if (pass) score += perCase;
    return {
      name: testCase.name ?? `场景 ${index + 1}`,
      status: pass ? "accepted" : "wrong_answer",
      score: pass ? perCase : 0,
      maxScore: perCase,
    };
  });

  return {
    status: score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer",
    score,
    maxScore: 100,
    detail: { tests },
  };
}

interface InteractiveConfig {
  n?: number;
  maxQueries?: number;
  seed?: number;
  timeLimitMs?: number;
}

/**
 * Interactive judging: the submission is spliced into a grader that exposes
 * `query()`/`answer()` and drives `solve()`, then the whole thing is compiled
 * and run for real. This is the reference implementation for what a real
 * interactive judge does — sandboxing and resource limits are the parts a
 * production judge must add on top.
 */
async function judgeInteractive(
  config: unknown,
  payload: unknown,
): Promise<Verdict> {
  const cfg = (config ?? {}) as InteractiveConfig;
  const n = cfg.n ?? 1_000_000;
  const maxQueries = cfg.maxQueries ?? 30;
  const seed = cfg.seed ?? 42;
  const timeLimitMs = cfg.timeLimitMs ?? 2000;
  const source = String((payload as { source?: unknown })?.source ?? "");

  // Deterministic LCG pick of the hidden answer; the player never sees it.
  let state = seed >>> 0;
  state = (state * 48271) % 2147483647;
  const answer = (state % n) + 1;

  const grader = `#include <bits/stdc++.h>
using namespace std;

static const long long ANSWER = ${answer}LL;
static const int MAX_QUERIES = ${maxQueries};
static int QUERY_COUNT = 0;
static bool ANSWERED = false;
static int LAST_ANSWER = -1;

void solve();

int query(int x) {
  if (QUERY_COUNT >= MAX_QUERIES) return 0;
  ++QUERY_COUNT;
  return x < ANSWER ? 1 : 0;
}

void answer(int x) { ANSWERED = true; LAST_ANSWER = x; }

// ===== player code =====
${source}
// ===== /player code =====

int main() {
  solve();
  if (!ANSWERED) { printf("NO_ANSWER\\n"); return 0; }
  bool ok = (LAST_ANSWER == ANSWER) && (QUERY_COUNT <= MAX_QUERIES);
  printf("ANSWER=%d QUERIES=%d OK=%d\\n", LAST_ANSWER, QUERY_COUNT, ok ? 1 : 0);
  return 0;
}`;

  const dir = mkdtempSync(join(tmpdir(), "foi-interactive-"));
  try {
    writeFileSync(join(dir, "prog.cpp"), grader);
    try {
      execFileSync("g++", ["-O2", "-std=c++17", "-o", join(dir, "prog"), join(dir, "prog.cpp")], {
        timeout: 10_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "编译失败";
      return {
        status: "compile_error",
        score: 0,
        maxScore: 100,
        detail: { message: stderr.slice(0, 2000) },
      };
    }

    let stdout = "";
    try {
      stdout = execFileSync(join(dir, "prog"), {
        timeout: timeLimitMs,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
    } catch (error) {
      const failed = error as { killed?: boolean; stderr?: Buffer; stdout?: Buffer };
      if (failed.killed) {
        return {
          status: "time_limit_exceeded",
          score: 0,
          maxScore: 100,
          detail: { message: "超出时间限制" },
        };
      }
      stdout = failed.stdout?.toString() ?? "";
    }

    const match = stdout.match(/ANSWER=(-?\d+) QUERIES=(\d+) OK=(\d)/);
    if (!match) {
      return {
        status: "runtime_error",
        score: 0,
        maxScore: 100,
        detail: { message: "程序异常退出，没有产出评测结果" },
      };
    }

    const submittedAnswer = Number(match[1]);
    const queries = Number(match[2]);
    const ok = match[3] === "1";

    if (ok) {
      return {
        status: "accepted",
        score: 100,
        maxScore: 100,
        detail: { message: `答案正确，共 ${queries} 次查询（上限 ${maxQueries}）` },
      };
    }
    if (submittedAnswer === answer && queries > maxQueries) {
      return {
        status: "partial",
        score: 50,
        maxScore: 100,
        detail: { message: `答案正确但查询了 ${queries} 次，超过上限 ${maxQueries}` },
      };
    }
    return {
      status: "wrong_answer",
      score: 0,
      maxScore: 100,
      detail: {
        message: `答案错误（提交 ${submittedAnswer}，正确 ${answer}），查询 ${queries} 次`,
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface PerformanceConfig {
  mode?: string;
  n?: number;
  warmupRuns?: number;
  timedRuns?: number;
  timeLimitMs?: number;
  compileFlags?: string;
}

/**
 * The baseline for the performance problem: plain i-j-k matrix multiplication.
 * Compiled once per judge process and reused across submissions, so the
 * baseline reflects this machine's speed, not a hard-coded constant.
 */
const NAIVE_MATMUL_SOURCE = `#include <bits/stdc++.h>
using namespace std;
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n;
  if (!(cin >> n)) return 0;
  vector<vector<long long>> a(n, vector<long long>(n));
  vector<vector<long long>> b(n, vector<long long>(n));
  vector<vector<long long>> c(n, vector<long long>(n));
  for (int i = 0; i < n; i++)
    for (int j = 0; j < n; j++) cin >> a[i][j];
  for (int i = 0; i < n; i++)
    for (int j = 0; j < n; j++) cin >> b[i][j];
  for (int i = 0; i < n; i++)
    for (int j = 0; j < n; j++)
      for (int k = 0; k < n; k++) c[i][j] += a[i][k] * b[k][j];
  for (int i = 0; i < n; i++) {
    for (int j = 0; j < n; j++) {
      if (j) cout << ' ';
      cout << c[i][j];
    }
    cout << '\\n';
  }
  return 0;
}`;

/** Long-lived asset dir (naive binary etc.) — never deleted for the process. */
const ASSET_DIR = mkdtempSync(join(tmpdir(), "foi-judge-assets-"));
let naiveMatmulBinary: string | null = null;

function compileNaiveMatmul(compileFlags: string): string {
  if (naiveMatmulBinary) return naiveMatmulBinary;
  const src = join(ASSET_DIR, "naive.cpp");
  const out = join(ASSET_DIR, "naive");
  writeFileSync(src, NAIVE_MATMUL_SOURCE);
  execFileSync("g++", [...compileFlags.split(/\s+/), "-o", out, src], {
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  naiveMatmulBinary = out;
  return out;
}

/** Deterministic n×n matrices so naive and submission see identical input. */
function genMatmulInput(n: number): string {
  const rows: string[] = [String(n)];
  const emit = (f: (i: number, j: number) => number) => {
    for (let i = 0; i < n; i++) {
      const row: string[] = [];
      for (let j = 0; j < n; j++) row.push(String(f(i, j)));
      rows.push(row.join(" "));
    }
  };
  emit((i, j) => (i * 31 + j * 17) % 100);
  emit((i, j) => (i * 13 + j * 7) % 100);
  return rows.join("\n");
}

function runTimed(
  binary: string,
  input: string,
  timeoutMs: number,
): { stdout: Buffer; timeMs: number; killed: boolean } {
  const start = process.hrtime.bigint();
  try {
    const stdout = execFileSync(binary, {
      input,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timeMs = Number(process.hrtime.bigint() - start) / 1e6;
    return { stdout, timeMs, killed: false };
  } catch (error) {
    const failed = error as { killed?: boolean };
    return {
      stdout: Buffer.alloc(0),
      timeMs: timeoutMs,
      killed: failed.killed ?? false,
    };
  }
}

/**
 * Performance judging: compile the submission, time the built-in baseline,
 * then time the submission (warmup + best of N timed runs), byte-compare the
 * output against the baseline and score by speedup.
 *
 * score = min(100, floor(50 * baseline / time)) — a 2× speedup is full marks,
 * an unoptimized copy of the baseline scores about 50.
 */
async function judgePerformance(
  config: unknown,
  payload: unknown,
): Promise<Verdict> {
  const cfg = (config ?? {}) as PerformanceConfig;
  const n = cfg.n ?? 512;
  const warmupRuns = cfg.warmupRuns ?? 1;
  const timedRuns = cfg.timedRuns ?? 3;
  const timeLimitMs = cfg.timeLimitMs ?? 8000;
  const compileFlags = cfg.compileFlags ?? "-O2 -std=c++17";
  const source = String((payload as { source?: unknown })?.source ?? "");

  const input = genMatmulInput(n);
  const naiveBin = compileNaiveMatmul(compileFlags);

  const dir = mkdtempSync(join(tmpdir(), "foi-perf-"));
  let binary: string;
  try {
    binary = join(dir, "prog");
    writeFileSync(join(dir, "prog.cpp"), source);
    execFileSync(
      "g++",
      [...compileFlags.split(/\s+/), "-o", binary, join(dir, "prog.cpp")],
      { timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "编译失败";
    return {
      status: "compile_error",
      score: 0,
      maxScore: 100,
      detail: { message: stderr.slice(0, 2000) },
    };
  }

  try {
    const baseline = runTimed(naiveBin, input, timeLimitMs);
    if (baseline.killed) {
      return {
        status: "system_error",
        score: 0,
        maxScore: 100,
        detail: { message: "基线评测超时" },
      };
    }
    const baselineMs = Math.max(1, baseline.timeMs);

    for (let i = 0; i < warmupRuns; i++) runTimed(binary, input, timeLimitMs);

    let best: { stdout: Buffer; timeMs: number } | null = null;
    let killed = false;
    const runs: number[] = [];
    for (let i = 0; i < timedRuns; i++) {
      const result = runTimed(binary, input, timeLimitMs);
      runs.push(Math.round(result.timeMs));
      if (result.killed) {
        killed = true;
        break;
      }
      if (!best || result.timeMs < best.timeMs) {
        best = { stdout: result.stdout, timeMs: result.timeMs };
      }
    }

    if (killed) {
      return {
        status: "time_limit_exceeded",
        score: 0,
        maxScore: 100,
        detail: { message: `超出时间限制（${timeLimitMs}ms）` },
      };
    }
    if (!best) {
      return {
        status: "runtime_error",
        score: 0,
        maxScore: 100,
        detail: { message: "程序没有产出任何输出" },
      };
    }

    if (!best.stdout.equals(baseline.stdout)) {
      return {
        status: "wrong_answer",
        score: 0,
        maxScore: 100,
        detail: {
          message: "输出与基线不一致",
          timeMs: Math.round(best.timeMs),
          baselineMs: Math.round(baselineMs),
        },
      };
    }

    const timeMs = Math.max(1, best.timeMs);
    const score = Math.min(100, Math.floor((50 * baselineMs) / timeMs));
    return {
      status: score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer",
      score,
      maxScore: 100,
      detail: {
        message: `耗时 ${Math.round(timeMs)}ms，基线 ${Math.round(baselineMs)}ms，加速比 ${(baselineMs / timeMs).toFixed(2)}x`,
        timeMs: Math.round(timeMs),
        baselineMs: Math.round(baselineMs),
        speedup: Number((baselineMs / timeMs).toFixed(2)),
        runs,
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Dispatches by payload shape, mirroring how a real judge would branch on the
 * problem's judge id: flag submissions carry `{ flag }`, output-only carry
 * `{ text }`, interactive problems declare `mode: "interactive"` in their
 * judge config, everything else is treated as code.
 */
async function evaluate(request: JudgeRequestBody): Promise<Verdict> {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const config = (request.problem.config ?? {}) as Record<string, unknown>;

  if (payload.flag !== undefined || config.mode === "static") {
    return judgeFlag(request.problem.config, request.payload);
  }
  if (payload.text !== undefined) {
    return judgeOutputOnly(request.problem.config, request.payload);
  }
  if (config.mode === "interactive") {
    return judgeInteractive(request.problem.config, request.payload);
  }
  if (config.mode === "performance") {
    return judgePerformance(request.problem.config, request.payload);
  }
  return judgeCode(request.problem.config, request.payload);
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

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ accepted: true, judgeRef: enqueue(body) }));
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
  console.log(`mock 题目后端监听 :${PORT}`);
  console.log(`  并发容量 ${CAPACITY}，单题耗时 ${JUDGE_DELAY_MS}ms`);
  if (DROP_CALLBACKS) console.log("  已开启丢弃回调模式，用于验证对账兜底");
});
