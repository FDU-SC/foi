import { createServer, type IncomingMessage } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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

// Before anything else: this judge compiles and runs submitted code on the
// host with no sandbox (see judgeInteractive/judgePerformance), which is an
// acceptable shortcut for local development and nothing else. Refuse to boot
// rather than become a remote code execution endpoint.
//
// The condition reads as "production" and blocks rather more than that: the
// Dockerfile sets NODE_ENV=production and all three deployed environments run
// that same image, so dev and staging are refused too. That is the intent — an
// unsandboxed evaluator is a way in from wherever it is reachable, and the
// tailnet is not a sandbox.
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "mock 题目后端没有沙箱，会在宿主机上直接编译并运行提交的代码，仅供本地开发；" +
      "检测到 NODE_ENV=production（三套部署环境都会命中），拒绝启动。",
  );
}

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

interface BackendUser {
  handle: string;
  groups: readonly string[];
}

interface JudgeRequestBody {
  submissionId: string;
  user: BackendUser;
  problem: { slug: string; config?: unknown };
  contestSlug: string | null;
  payload: unknown;
  callbackUrl: string;
  callbackToken: string;
}

interface ActionRequestBody {
  action: string;
  user: BackendUser;
  problem: { slug: string; config?: unknown };
  contestSlug: string | null;
  payload: unknown;
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

/**
 * Containers this backend has handed out, and the flag inside each.
 *
 * Here rather than in a separate service, and that is the whole demonstration.
 * A flag that is the same for everybody is solved once and then posted in a
 * group chat, so a real container problem mints a fresh one per instance —
 * which means the only party that can check a flag is the party that created
 * the container. Splitting orchestration from checking would leave two
 * services needing to agree on this map.
 *
 * In memory because it is a mock; a real one would outlive a restart.
 */
interface Instance {
  handle: string;
  endpoint: string;
  flag: string;
  expiresAt: number;
}

const instances = new Map<string, Instance>();
/** Flag back to its instance, so checking a submission is one lookup. */
const flagOwners = new Map<string, string>();

function instanceKey(slug: string, handle: string): string {
  return `${slug}:${handle}`;
}

function dropInstance(key: string): void {
  const existing = instances.get(key);
  if (!existing) return;
  flagOwners.delete(existing.flag);
  instances.delete(key);
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

/**
 * Hands this person a container, or the one they already have.
 *
 * Idempotent because the kernel's rate limit bounds how often somebody may
 * ask, not how many they end up with: two clicks a minute apart should not
 * leave a container orphaned. The per-person cap is one, and it is enforced
 * here because this is the only place that knows what a container costs.
 */
function spawnInstance(body: ActionRequestBody): Instance {
  const key = instanceKey(body.problem.slug, body.user.handle);

  const existing = liveInstance(key);
  if (existing) return existing;

  const config = (body.problem.config ?? {}) as { lifetimeSeconds?: number };
  const lifetime = (config.lifetimeSeconds ?? 30 * 60) * 1000;
  const port = 30000 + Math.floor(Math.random() * 5000);
  const instance: Instance = {
    handle: body.user.handle,
    endpoint: `http://chal.foi.internal:${port}`,
    flag: `FOI{r4te_l1m1t_bypa55ed_${randomBytes(4).toString("hex")}}`,
    expiresAt: Date.now() + lifetime,
  };

  instances.set(key, instance);
  flagOwners.set(instance.flag, key);
  // The flag is printed because there is no container to read it out of. A
  // real backend would put it inside the instance and never log it; here the
  // console is the only way the demo problem is solvable at all.
  console.log(
    `  启动实例 ${body.problem.slug} for ${body.user.handle} -> ${instance.endpoint}`,
  );
  console.log(`    flag: ${instance.flag}`);
  return instance;
}

/**
 * Checks a flag against the instance it came from.
 *
 * Two failures that look the same to the player but are not: a flag nobody was
 * ever issued, and somebody else's flag. The second is the one dynamic flags
 * exist to catch, so it is worth a distinct log line even though the verdict
 * is the same — telling the submitter which it was would confirm that the flag
 * is real and merely stolen.
 */
function judgeInstanceFlag(request: JudgeRequestBody): Verdict {
  const submitted = String(
    (request.payload as { flag?: unknown })?.flag ?? "",
  ).trim();

  const key = flagOwners.get(submitted);
  const owner = key ? liveInstance(key) : undefined;
  const mine = owner?.handle === request.user.handle;

  if (key && !mine) {
    console.log(
      `  ${request.user.handle} 提交了属于他人的 flag（${key}），判错`,
    );
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

interface OutputCase {
  name?: string;
  expected?: string;
}

/**
 * Daily roulette check-in: the day's result is derived from the date, so
 * everyone faces the same wheel and nobody — not even the setter — can know
 * it before submitting. The verdict reveals the outcome.
 *
 * Bets: exact number (0-36), colour (red/black/green), or size (big 19-36,
 * small 1-18; 0 is neither). Scores come from the problem config.
 */
function judgeRoulette(
  config: unknown,
  payload: unknown,
  now = new Date(),
): Verdict {
  const cfg = (config ?? {}) as {
    scoreNumber?: number;
    scoreColor?: number;
    scoreSize?: number;
  };
  const scoreNumber = cfg.scoreNumber ?? 100;
  const scoreColor = cfg.scoreColor ?? 30;
  const scoreSize = cfg.scoreSize ?? 10;

  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const digest = createHash("sha256").update(`roulette:${day}`).digest();
  const number = digest.readUInt32BE(0) % 37;
  const color = number === 0 ? "green" : number % 2 === 1 ? "red" : "black";
  const size = number === 0 ? null : number <= 18 ? "small" : "big";

  const submitted = String((payload as { text?: unknown })?.text ?? "")
    .trim()
    .toLowerCase();

  let score = 0;
  let hit: string;
  if (submitted === String(number)) {
    score = scoreNumber;
    hit = `押中数字 ${number}`;
  } else if (submitted === color) {
    score = scoreColor;
    hit = `押中颜色 ${color}`;
  } else if (size !== null && submitted === size) {
    score = scoreSize;
    hit = `押中大小 ${size}`;
  } else {
    hit = `未命中（${submitted || "空"}）`;
  }

  return {
    status: score >= scoreNumber ? "accepted" : score > 0 ? "partial" : "wrong_answer",
    score,
    maxScore: scoreNumber,
    detail: {
      number,
      color,
      size,
      hit,
      message: `今日结果：数字 ${number}（${color}${size ? `，${size}` : ""}）。你押「${submitted}」→ ${hit}${score > 0 ? `，+${score} 分` : "，0 分"}。明天再来！`,
    },
  };
}

// ---------------------------------------------------------------------------
// Game of Life helpers (shared by judgePeriodicOscillator)
// ---------------------------------------------------------------------------

type LifeGrid = number[][];

function lifeStep(grid: LifeGrid): LifeGrid {
  const rows = grid.length;
  const cols = grid[0].length;
  const next: LifeGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let neighbors = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (di === 0 && dj === 0) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && ni < rows && nj >= 0 && nj < cols && grid[ni][nj]) {
            neighbors++;
          }
        }
      }
      next[i][j] = grid[i][j]
        ? neighbors === 2 || neighbors === 3
          ? 1
          : 0
        : neighbors === 3
          ? 1
          : 0;
    }
  }
  return next;
}

function lifeEquals(a: LifeGrid, b: LifeGrid): boolean {
  return a.every((row, i) => row.every((cell, j) => cell === b[i][j]));
}

/** Surrounds the pattern with dead cells so its evolution can breathe. */
function lifePadded(grid: LifeGrid, pad: number): LifeGrid {
  const rows = grid.length;
  const cols = grid[0].length;
  const out: LifeGrid = Array.from({ length: rows + 2 * pad }, () =>
    Array(cols + 2 * pad).fill(0),
  );
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[i + pad][j + pad] = grid[i][j];
  }
  return out;
}

/** Parses '.', 'O', '0', '1' rows into a rectangular grid; null on bad input. */
function lifeParse(text: string): LifeGrid | null {
  const rows: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const row: number[] = [];
    for (const ch of line) {
      if (ch === "." || ch === "0") row.push(0);
      else if (ch === "O" || ch === "1") row.push(1);
      else return null;
    }
    rows.push(row);
  }
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array(width - row.length).fill(0)]);
}

interface PeriodicCase {
  name?: string;
  maxDim?: number;
  k?: number;
}

/**
 * The oscillator problem: each scene asks for a pattern whose *minimal*
 * period is exactly k — the k-th generation equals the initial state and no
 * earlier generation does. This is the Special-Judge shape: any pattern with
 * the property scores, not one fixed answer.
 *
 * Simulation runs on a generously padded field, because intermediate states
 * commonly breathe wider than the submitted box — a 13×13 pulsar only has
 * period 3 when its frame sits inside a larger field. The size check still
 * applies to the submitted grid itself.
 */
function judgePeriodicOscillator(
  config: unknown,
  payload: unknown,
): Verdict {
  const cases = ((config as { cases?: PeriodicCase[] })?.cases ?? []).filter(
    (c) => c.k !== undefined && c.maxDim !== undefined,
  );
  const text = String((payload as { text?: unknown })?.text ?? "");
  const grids = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (cases.length === 0) {
    return {
      status: "system_error",
      score: 0,
      maxScore: 100,
      detail: { message: "评测机配置缺少 cases" },
    };
  }

  const perCase = 100 / cases.length;
  let score = 0;
  const tests = cases.map((testCase, index) => {
    const name = testCase.name ?? `场景 ${index + 1}`;
    const fail = (message: string) => ({
      name,
      status: "wrong_answer" as const,
      score: 0,
      maxScore: perCase,
      message,
    });

    const grid = lifeParse(grids[index] ?? "");
    if (!grid) {
      return fail("提交的网格缺失或格式不对（每行只能包含 . 和 O）");
    }
    const dim = testCase.maxDim ?? 50;
    if (grid.length > dim || grid[0].length > dim) {
      return fail(`尺寸 ${grid.length}×${grid[0].length} 超过上限 ${dim}×${dim}`);
    }
    if (grid.flat().every((cell) => cell === 0)) {
      return fail("图案为空：至少需要 1 个活细胞");
    }

    const k = testCase.k ?? 2;
    const PAD = 8;
    let current = lifePadded(grid, PAD);
    const initial = current;
    for (let t = 1; t <= k; t++) {
      current = lifeStep(current);
      if (t < k) {
        if (lifeEquals(current, initial)) {
          return fail(`第 ${t} 代就回到了初始状态——最小周期是 ${t}，不是 ${k}`);
        }
      } else if (!lifeEquals(current, initial)) {
        return fail(`第 ${k} 代没有回到初始状态——这不是 ${k} 周期`);
      }
    }

    score += perCase;
    return {
      name,
      status: "accepted" as const,
      score: perCase,
      maxScore: perCase,
      message: `最小周期恰为 ${k} ✓（${grid.length}×${grid[0].length}，${grid.flat().filter(Boolean).length} 个活细胞）`,
    };
  });

  return {
    status: score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer",
    score,
    maxScore: 100,
    detail: { tests },
  };
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
      detail: { message: "评测机配置缺少 cases" },
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

  // A problem that hands out containers has no static answer to compare
  // against — the flag belongs to one instance and one person.
  if (config.image !== undefined) {
    return judgeInstanceFlag(request);
  }
  // Roulette also submits `{ text }`, so it must be checked before the
  // generic output-only branch.
  if (config.mode === "roulette") {
    return judgeRoulette(request.problem.config, request.payload);
  }
  if (config.mode === "periodic") {
    return judgePeriodicOscillator(request.problem.config, request.payload);
  }
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
    // Required by the protocol. The kernel records it against the submission
    // so a verdict stays reproducible: its own release sha pins the problem
    // definition, and this pins the testdata and checker that produced the
    // result — the half that does not live in the FOI repository.
    backendVersion: VERSION,
    ...verdict,
  });
  const timestamp = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(body.callbackUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: String(timestamp),
        // The path is signed, and it has to be the path of the callback URL
        // the kernel handed over at dispatch — that is the one the kernel
        // verifies against, whatever a reverse proxy in between does to it.
        [SIGNATURE_HEADER]: sign(secret!, timestamp, {
          method: "PUT",
          path: new URL(body.callbackUrl).pathname,
          body: payload,
        }),
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

  // Verified before anything routes on the path, and the path is part of what
  // is verified. Those two together are what make the path-based dispatch
  // below safe: the action cannot have been rewritten in transit, so reading
  // it off the path is as trustworthy as reading it out of the signed body.
  const check = verifySignature({
    secret: secret!,
    timestamp: (req.headers[TIMESTAMP_HEADER] as string | undefined) ?? null,
    signature: (req.headers[SIGNATURE_HEADER] as string | undefined) ?? null,
    request: {
      method: req.method ?? "",
      path: url.pathname + url.search,
      body: raw,
    },
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

  // Interactive endpoints. The kernel has already established that whoever is
  // asking may see the problem and that the problem declared this action; what
  // is left is the part only this service can do.
  if (req.method === "POST" && url.pathname.startsWith("/action/")) {
    const action = decodeURIComponent(url.pathname.slice("/action/".length));
    const body = JSON.parse(raw) as ActionRequestBody;

    if (action === "spawn") {
      const instance = spawnInstance(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          endpoint: instance.endpoint,
          expiresAt: instance.expiresAt,
        }),
      );
      return;
    }

    if (action === "destroy") {
      dropInstance(instanceKey(body.problem.slug, body.user.handle));
      console.log(`  销毁实例 ${body.problem.slug} for ${body.user.handle}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    console.warn(`  未实现的 action: ${action}`);
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `未实现的 action: ${action}` }));
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
    // The version rides along even while `done` is false: there is no verdict
    // to attach it to yet, which is exactly why it belongs on the envelope.
    res.end(
      JSON.stringify(
        done
          ? { done, verdict: job.verdict, backendVersion: VERSION }
          : { done: false, backendVersion: VERSION },
      ),
    );
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
