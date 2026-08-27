import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  sign,
  verifySignature,
} from "../lib/backend/signature";
import { effectiveSecretFromEnv } from "../lib/backend/env";
import type { JobDetails, JobTicket, Verdict } from "../lib/backend/types";
import { backends } from "../content/backends";

if (process.env.NODE_ENV === "production") {
  throw new Error(
    "mock 评测机没有沙箱，会在宿主机上直接编译并运行提交的代码，仅供本地开发；" +
      "检测到 NODE_ENV=production（三套部署环境都会命中），拒绝启动。",
  );
}

const KERNEL_URL =
  process.env.MOCK_KERNEL_URL ??
  process.env.FOI_PUBLIC_URL ??
  "http://localhost:3000";

const BACKEND_IDS = (
  process.env.MOCK_BACKEND_IDS ?? Object.keys(backends).join(",")
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const RUNNER_ID = process.env.MOCK_RUNNER_ID ?? `mock-${hostname()}-${process.pid}`;

const CAPACITY = Number(process.env.MOCK_BACKEND_CAPACITY ?? 2);

const POLL_INTERVAL_MS = Number(process.env.MOCK_POLL_INTERVAL ?? 1000);

const HEARTBEAT_INTERVAL_MS = Number(process.env.MOCK_HEARTBEAT_INTERVAL ?? 20_000);

const PORT = Number(process.env.MOCK_BACKEND_PORT ?? 4100);
const JUDGE_DELAY_MS = Number(process.env.MOCK_BACKEND_DELAY ?? 1500);

const SPAWN_DELAY_MS = Number(process.env.MOCK_SPAWN_DELAY ?? 3000);

const VERSION = "2.0.0";

const GO_SILENT = process.argv.includes("--go-silent");

function secretFor(backendId: string): string {
  const secret = effectiveSecretFromEnv(backendId);
  if (!secret) {
    throw new Error(`缺少 ${backendId} 的签名密钥：设置 FOI_BACKEND_SECRET`);
  }
  return secret;
}

const startedAt = Date.now();

interface ActionRequestBody {
  action: string;
  user: { uid: number; groups: readonly string[] };
  problem: { slug: string; config?: unknown };
  contestSlug: string | null;
  payload: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(
  backendId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = new URL(path, KERNEL_URL);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);

  return fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      [TIMESTAMP_HEADER]: String(timestamp),
      [SIGNATURE_HEADER]: sign(secretFor(backendId), timestamp, {
        method,
        path: url.pathname + url.search,
        body: payload,
      }),
    },
    body: payload === "" ? undefined : payload,
  });
}

async function claim(backendId: string): Promise<JobTicket | null> {
  const res = await call(backendId, "POST", "/api/runner/jobs/request", {
    backendId,
    runnerId: RUNNER_ID,
    nonce: randomBytes(16).toString("hex"),
  });

  if (res.status === 204) return null;
  if (!res.ok) {
    console.error(`  领取失败 ${backendId} -> ${res.status} ${await res.text()}`);
    return null;
  }
  return (await res.json()) as JobTicket;
}

async function fetchDetails(
  backendId: string,
  ticket: JobTicket,
): Promise<JobDetails | null> {
  const res = await call(
    backendId,
    "GET",
    `/api/runner/jobs/${encodeURIComponent(ticket.id)}?lease=${encodeURIComponent(ticket.lease)}`,
  );

  if (res.ok) return (await res.json()) as JobDetails;

  console.error(`  取详情失败 ${ticket.id} -> ${res.status}`);
  return null;
}

async function report(
  backendId: string,
  ticket: JobTicket,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await call(
    backendId,
    "PUT",
    `/api/runner/jobs/${encodeURIComponent(ticket.id)}`,
    { lease: ticket.lease, ...body },
  );

  if (res.status === 409) {
    console.warn(`  ${ticket.id} 的 lease 已失效，放弃这份工作`);
    return false;
  }
  if (!res.ok) {
    console.error(`  上报失败 ${ticket.id} -> ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

async function work(backendId: string, ticket: JobTicket): Promise<void> {
  if (GO_SILENT) {
    console.log(`  [go-silent] 领走 ${ticket.id} 之后什么都不做`);
    return;
  }

  const details = await fetchDetails(backendId, ticket);
  if (!details) return;

  console.log(
    `领取 ${details.id} (${details.problem.slug}, ${details.user.uid}) on ${backendId}`,
  );

  let status = "已领取";
  const say = (next: string) => {
    status = next;
  };

  const heartbeat = setInterval(() => {
    void report(backendId, ticket, { state: "alive", status });
  }, HEARTBEAT_INTERVAL_MS);

  try {

    say("排队等待评测槽位");
    await sleep(JUDGE_DELAY_MS);

    const verdict = await evaluate(details, say);
    await report(backendId, ticket, {
      state: "done",
      verdict,
      backendVersion: VERSION,
    });
    console.log(
      `  完成 ${details.id} -> ${verdict.status} ${verdict.score}/${verdict.maxScore}`,
    );
  } catch (error) {

    const reason = error instanceof Error ? error.message : "评测异常";
    await report(backendId, ticket, {
      state: "failed",
      reason,
      backendVersion: VERSION,
    });
    console.error(`  评测失败 ${details.id}: ${reason}`);
  } finally {
    clearInterval(heartbeat);
  }
}

async function serve(backendId: string): Promise<void> {
  let held = 0;

  for (;;) {
    try {
      while (held < CAPACITY) {
        const ticket = await claim(backendId);
        if (!ticket) break;

        held += 1;
        void work(backendId, ticket).finally(() => {
          held -= 1;
        });
      }
    } catch (error) {
      console.error(`  领活循环 ${backendId} 出错`, error);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

interface RunResult {
  stdout: Buffer;
  stderr: Buffer;
  code: number | null;
  killed: boolean;
}

function run(
  file: string,
  args: string[],
  options: { input?: string; timeout?: number; maxBuffer?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        encoding: "buffer",
      },
      (error, stdout, stderr) => {
        const failed = error as (Error & { code?: number; killed?: boolean }) | null;
        resolve({
          stdout: stdout as Buffer,
          stderr: stderr as Buffer,
          code: failed ? (failed.code ?? 1) : 0,
          killed: failed?.killed ?? false,
        });
      },
    );

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

type Say = (status: string) => void;

function judgeCode(config: unknown, payload: unknown, say: Say): Verdict {
  const source = String((payload as { source?: unknown })?.source ?? "");
  const subtasks =
    (config as { subtasks?: { name: string; score: number }[] })?.subtasks ?? [
      { name: "全部数据", score: 100 },
    ];

  const looksCorrect = /queue|bfs|deque/i.test(source);
  const hasContent = source.trim().length > 0;

  let score = 0;
  const tests = subtasks.map((subtask, index) => {
    say(`测试点 ${index + 1}/${subtasks.length}`);
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

interface Instance {
  id: string;
  uid: number;
  endpoint: string;
  flag: string;

  readyAt: number;
  expiresAt: number;
}

const instances = new Map<string, Instance>();

const flagOwners = new Map<string, string>();

function instanceKey(slug: string, uid: number): string {
  return `${slug}:${uid}`;
}

function dropInstance(key: string): void {
  const existing = instances.get(key);
  if (!existing) return;
  flagOwners.delete(existing.flag);
  instances.delete(key);
}

function instanceView(instance: Instance): Record<string, unknown> {
  if (Date.now() < instance.readyAt) {
    return { instanceId: instance.id, status: "pulling" };
  }
  return {
    instanceId: instance.id,
    status: "ready",
    endpoint: instance.endpoint,
    expiresAt: instance.expiresAt,
  };
}

function liveInstance(key: string): Instance | undefined {
  const existing = instances.get(key);
  if (!existing) return undefined;
  if (existing.expiresAt <= Date.now()) {
    dropInstance(key);
    return undefined;
  }
  return existing;
}

function spawnInstance(body: ActionRequestBody): Instance {
  const key = instanceKey(body.problem.slug, body.user.uid);

  const existing = liveInstance(key);
  if (existing) return existing;

  const config = (body.problem.config ?? {}) as { lifetimeSeconds?: number };
  const lifetime = (config.lifetimeSeconds ?? 30 * 60) * 1000;
  const port = 30000 + Math.floor(Math.random() * 5000);
  const instance: Instance = {
    id: randomUUID(),
    uid: body.user.uid,
    endpoint: `http://chal.foi.internal:${port}`,
    flag: `FOI{r4te_l1m1t_bypa55ed_${randomBytes(4).toString("hex")}}`,
    readyAt: Date.now() + SPAWN_DELAY_MS,
    expiresAt: Date.now() + lifetime,
  };

  instances.set(key, instance);
  flagOwners.set(instance.flag, key);

  console.log(
    `  启动实例 ${body.problem.slug} for ${body.user.uid} -> ${instance.endpoint}`,
  );
  console.log(`    flag: ${instance.flag}`);
  return instance;
}

function judgeInstanceFlag(job: JobDetails): Verdict {
  const submitted = String((job.payload as { flag?: unknown })?.flag ?? "").trim();

  const key = flagOwners.get(submitted);
  const owner = key ? liveInstance(key) : undefined;
  const mine = owner?.uid === job.user.uid;

  if (key && !mine) {
    console.log(`  ${job.user.uid} 提交了属于他人的 flag（${key}），判错`);
  }

  return {
    status: mine ? "accepted" : "wrong_answer",
    score: mine ? 300 : 0,
    maxScore: 300,
    detail: {
      message: mine
        ? "flag 正确"
        : "flag 不正确。每个实例的 flag 都不一样，请提交你自己那台靶机吐出的那一个。",
    },
  };
}

interface InteractiveConfig {
  n?: number;
  maxQueries?: number;
  seed?: number;
  timeLimitMs?: number;
}

async function judgeInteractive(
  config: unknown,
  payload: unknown,
  say: Say,
): Promise<Verdict> {
  const cfg = (config ?? {}) as InteractiveConfig;
  const n = cfg.n ?? 1_000_000;
  const maxQueries = cfg.maxQueries ?? 30;
  const seed = cfg.seed ?? 42;
  const timeLimitMs = cfg.timeLimitMs ?? 2000;
  const source = String((payload as { source?: unknown })?.source ?? "");

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

    say("编译交互器与选手代码");
    const compiled = await run(
      "g++",
      ["-O2", "-std=c++17", "-o", join(dir, "prog"), join(dir, "prog.cpp")],
      { timeout: 10_000 },
    );
    if (compiled.code !== 0) {
      return {
        status: "compile_error",
        score: 0,
        maxScore: 100,
        detail: {
          message: (compiled.stderr.toString() || "编译失败").slice(0, 2000),
        },
      };
    }

    say("运行交互");
    const ran = await run(join(dir, "prog"), [], { timeout: timeLimitMs });
    if (ran.killed) {
      return {
        status: "time_limit_exceeded",
        score: 0,
        maxScore: 100,
        detail: { message: "超出时间限制" },
      };
    }
    const stdout = ran.stdout.toString();

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

const ASSET_DIR = mkdtempSync(join(tmpdir(), "foi-judge-assets-"));
let naiveMatmulBinary: string | null = null;

async function compileNaiveMatmul(compileFlags: string): Promise<string> {
  if (naiveMatmulBinary) return naiveMatmulBinary;
  const src = join(ASSET_DIR, "naive.cpp");
  const out = join(ASSET_DIR, "naive");
  writeFileSync(src, NAIVE_MATMUL_SOURCE);
  const compiled = await run("g++", [...compileFlags.split(/\s+/), "-o", out, src], {
    timeout: 30_000,
  });
  if (compiled.code !== 0) {
    throw new Error(`基线编译失败: ${compiled.stderr.toString().slice(0, 500)}`);
  }
  naiveMatmulBinary = out;
  return out;
}

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

async function runTimed(
  binary: string,
  input: string,
  timeoutMs: number,
): Promise<{ stdout: Buffer; timeMs: number; killed: boolean }> {
  const start = process.hrtime.bigint();
  const result = await run(binary, [], {
    input,
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.killed || result.code !== 0) {
    return { stdout: Buffer.alloc(0), timeMs: timeoutMs, killed: result.killed };
  }
  return {
    stdout: result.stdout,
    timeMs: Number(process.hrtime.bigint() - start) / 1e6,
    killed: false,
  };
}

async function judgePerformance(
  config: unknown,
  payload: unknown,
  say: Say,
): Promise<Verdict> {
  const cfg = (config ?? {}) as PerformanceConfig;
  const n = cfg.n ?? 512;
  const warmupRuns = cfg.warmupRuns ?? 1;
  const timedRuns = cfg.timedRuns ?? 3;
  const timeLimitMs = cfg.timeLimitMs ?? 8000;
  const compileFlags = cfg.compileFlags ?? "-O2 -std=c++17";
  const source = String((payload as { source?: unknown })?.source ?? "");

  const input = genMatmulInput(n);

  let naiveBin: string;
  try {
    say("编译基线");
    naiveBin = await compileNaiveMatmul(compileFlags);
  } catch (error) {

    throw new Error(error instanceof Error ? error.message : "基线不可用");
  }

  const dir = mkdtempSync(join(tmpdir(), "foi-perf-"));
  const binary = join(dir, "prog");
  writeFileSync(join(dir, "prog.cpp"), source);
  say("编译提交");
  const compiled = await run(
    "g++",
    [...compileFlags.split(/\s+/), "-o", binary, join(dir, "prog.cpp")],
    { timeout: 30_000 },
  );
  if (compiled.code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return {
      status: "compile_error",
      score: 0,
      maxScore: 100,
      detail: {
        message: (compiled.stderr.toString() || "编译失败").slice(0, 2000),
      },
    };
  }

  try {
    say("测量基线耗时");
    const baseline = await runTimed(naiveBin, input, timeLimitMs);
    if (baseline.killed) {
      throw new Error("基线评测超时");
    }
    const baselineMs = Math.max(1, baseline.timeMs);

    for (let i = 0; i < warmupRuns; i++) {
      say(`预热 ${i + 1}/${warmupRuns}`);
      await runTimed(binary, input, timeLimitMs);
    }

    let best: { stdout: Buffer; timeMs: number } | null = null;
    let killed = false;
    const runs: number[] = [];
    for (let i = 0; i < timedRuns; i++) {
      say(`计时运行 ${i + 1}/${timedRuns}`);
      const result = await runTimed(binary, input, timeLimitMs);
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

async function evaluate(job: JobDetails, say: Say): Promise<Verdict> {
  const config = (job.problem.config ?? {}) as Record<string, unknown>;

  if (config.image !== undefined) {
    return judgeInstanceFlag(job);
  }
  if (config.mode === "interactive") {
    return judgeInteractive(job.problem.config, job.payload, say);
  }
  if (config.mode === "performance") {
    return judgePerformance(job.problem.config, job.payload, say);
  }
  return judgeCode(job.problem.config, job.payload, say);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const raw = await readBody(req);

  const attempts = BACKEND_IDS.map((id) =>
    verifySignature({
      secret: secretFor(id),
      timestamp: (req.headers[TIMESTAMP_HEADER] as string | undefined) ?? null,
      signature: (req.headers[SIGNATURE_HEADER] as string | undefined) ?? null,
      request: {
        method: req.method ?? "",
        path: url.pathname + url.search,
        body: raw,
      },
    }),
  );

  if (!attempts.some((attempt) => attempt.ok)) {
    const reason =
      attempts.find(
        (attempt): attempt is { ok: false; reason: string } => !attempt.ok,
      )?.reason ?? "签名不匹配";
    console.warn(`  拒绝未签名请求 ${req.method} ${url.pathname}: ${reason}`);
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: reason }));
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/action/")) {
    const action = decodeURIComponent(url.pathname.slice("/action/".length));
    const body = JSON.parse(raw) as ActionRequestBody;

    if (action === "spawn") {
      const instance = spawnInstance(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(instanceView(instance)));
      return;
    }

    if (action === "poll") {
      const instance = liveInstance(
        instanceKey(body.problem.slug, body.user.uid),
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(instance ? instanceView(instance) : { status: "gone" }),
      );
      return;
    }

    if (action === "destroy") {
      dropInstance(instanceKey(body.problem.slug, body.user.uid));
      console.log(`  销毁实例 ${body.problem.slug} for ${body.user.uid}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    console.warn(`  未实现的 action: ${action}`);
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `未实现的 action: ${action}` }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`mock 评测机 ${RUNNER_ID}`);
  console.log(`  平台 ${KERNEL_URL}，服务队列 ${BACKEND_IDS.join("、")}`);
  console.log(
    `  并发 ${CAPACITY}/队列，领活间隔 ${POLL_INTERVAL_MS}ms，心跳 ${HEARTBEAT_INTERVAL_MS}ms`,
  );
  console.log(`  交互动作监听 :${PORT}（仅 leaky-bucket 需要）`);
  if (GO_SILENT) {
    console.log("  已开启 go-silent 模式：领了活就不再心跳，用于验证重新入队");
  }
  console.log(`  启动于 ${new Date(startedAt).toISOString()}`);

  for (const backendId of BACKEND_IDS) void serve(backendId);
});
