#!/usr/bin/env node
/**
 * 模拟评测机：走完整的领活协议，但不编译、不执行、不读取任何提交内容。
 *
 * 用途有两个。一是公开 demo 站——那里没有判题机，需要外部后端的题目会永远停在
 * 队列里；二是本地体验，clone 下来就能把提交流程走通，不必先架一套判题机。
 *
 * 判定完全是假的，由 payload 的哈希确定性派生，同一份提交每次得到同样的结果。
 * 这一点会写进 detail.message，页面上看得见。
 *
 * 与 scripts/mock-runner.ts 的区别：那个会真的调 g++ 编译并运行提交的代码，没有
 * 任何沙箱，只能在本机开发时用。这个不碰用户代码，所以可以面向公众。
 *
 * 用法：
 *   FOI_STUB_RUNNER=yes-fake-verdicts node scripts/stub-runner.cjs
 */

"use strict";

const { createHmac, createHash, randomBytes } = require("node:crypto");
const { hostname } = require("node:os");

const CONFIRM = "yes-fake-verdicts";

const KERNEL_URL =
  process.env.FOI_KERNEL_URL || process.env.FOI_PUBLIC_URL || "http://localhost:3000";

const BACKEND_IDS = (process.env.FOI_STUB_BACKENDS || "traditional,interactive,performance")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const RUNNER_ID = process.env.FOI_STUB_RUNNER_ID || `stub-${hostname()}-${process.pid}`;
const CAPACITY = positiveInt(process.env.FOI_STUB_CAPACITY, 2);
const POLL_INTERVAL_MS = positiveInt(process.env.FOI_STUB_POLL_INTERVAL, 1000);
const HEARTBEAT_INTERVAL_MS = positiveInt(process.env.FOI_STUB_HEARTBEAT_INTERVAL, 20_000);

/** 假装在评测的时长。太快了不像真的，页面上的状态流转也看不清。 */
const JUDGE_DELAY_MS = positiveInt(process.env.FOI_STUB_DELAY, 1500);

/** 上报的版本号。运维台的评测机状态板会显示它，一眼能看出接的是模拟评测机。 */
const BACKEND_VERSION = "stub-demo";

const SIMULATION_NOTE =
  "这是模拟评测机：它不会编译或运行你提交的代码，上面的结果是按提交内容的哈希预设的。";

function positiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function secretFor(backendId) {
  const fragment = backendId.replace(/-/g, "_").toUpperCase();
  const secret =
    process.env[`FOI_BACKEND_${fragment}_SECRET`] || process.env.FOI_BACKEND_SECRET;
  if (!secret) {
    throw new Error(
      `缺少 ${backendId} 的签名密钥：设置 FOI_BACKEND_${fragment}_SECRET 或 FOI_BACKEND_SECRET`,
    );
  }
  return secret;
}

/**
 * 与 lib/backend/signature.ts 同一套算法：规范串是
 * `timestamp\nMETHOD\npath+search\nbody` 四行拼接，摘要形如 sha256=<hex>。
 * 这里手写一份而不是 import，是因为生产镜像里没有 TypeScript 运行时。
 */
function sign(secret, timestamp, method, path, body) {
  const canonical = [String(timestamp), method.toUpperCase(), path, body].join("\n");
  return `sha256=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
}

async function call(backendId, method, path, body) {
  const url = new URL(path, KERNEL_URL);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);

  return fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-foi-timestamp": String(timestamp),
      "x-foi-signature": sign(
        secretFor(backendId),
        timestamp,
        method,
        url.pathname + url.search,
        payload,
      ),
    },
    body: payload === "" ? undefined : payload,
  });
}

async function claim(backendId) {
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
  return res.json();
}

async function fetchDetails(backendId, ticket) {
  const res = await call(
    backendId,
    "GET",
    `/api/runner/jobs/${encodeURIComponent(ticket.id)}?lease=${encodeURIComponent(ticket.lease)}`,
  );
  if (res.ok) return res.json();

  console.error(`  取详情失败 ${ticket.id} -> ${res.status}`);
  return null;
}

async function report(backendId, ticket, body) {
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

/** 由提交内容派生的稳定伪随机数，同一份提交每次得到同一串数。 */
function seedOf(payload) {
  const digest = createHash("sha256").update(JSON.stringify(payload ?? null)).digest();
  let cursor = 0;
  return () => {
    const value = digest.readUInt32BE(cursor % (digest.length - 4));
    cursor += 4;
    return value;
  };
}

/**
 * 判定的形状必须满足 content/ 里组件的读法：result.accepted 供 acm 与 ctf-dynamic
 * 排行榜读，result.score / maxScore 供 oi 排行榜读，result.status 必须落在
 * content/_shared/verdicts.ts 的九个键里，detail.tests[] 由 tests-table 渲染。
 */
function verdictFor(details) {
  const config = details.problem?.config ?? {};
  const declared = Array.isArray(config.subtasks) ? config.subtasks : [];
  const subtasks =
    declared.length > 0 ? declared : [{ name: "全部数据", score: 100 }];

  const next = seedOf(details.payload);
  const source = String(details.payload?.source ?? details.payload?.flag ?? "");

  if (source.trim().length === 0) {
    return {
      result: { status: "compile_error", score: 0, maxScore: 100, accepted: false },
      detail: { message: `提交内容为空。\n\n${SIMULATION_NOTE}` },
    };
  }

  // 大多数提交给过，少数给错——demo 的意义在于让人看到两种结果各自长什么样，
  // 而不是把人卡住。
  const failing = next() % 5 === 0 ? next() % subtasks.length : -1;

  let score = 0;
  const tests = subtasks.map((subtask, index) => {
    const points = typeof subtask.score === "number" ? subtask.score : 100;
    const passed = index !== failing;
    if (passed) score += points;
    return {
      name: subtask.name || `子任务 ${index + 1}`,
      status: passed ? "accepted" : "wrong_answer",
      score: passed ? points : 0,
      maxScore: points,
      time: 15 + (next() % 200),
      memory: 2048 + (next() % 8192),
    };
  });

  const maxScore = tests.reduce((sum, test) => sum + test.maxScore, 0);
  const accepted = score === maxScore;

  return {
    result: {
      status: accepted ? "accepted" : score > 0 ? "partial" : "wrong_answer",
      score,
      maxScore,
      accepted,
    },
    detail: { tests, message: SIMULATION_NOTE },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function work(backendId, ticket) {
  const details = await fetchDetails(backendId, ticket);
  if (!details) return;

  console.log(`领取 ${details.id}（${details.problem?.slug}，uid ${details.user?.uid}）`);

  const heartbeat = setInterval(() => {
    void report(backendId, ticket, { state: "alive", status: "模拟评测中" });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    await sleep(JUDGE_DELAY_MS);
    const verdict = verdictFor(details);
    await report(backendId, ticket, {
      state: "done",
      verdict,
      backendVersion: BACKEND_VERSION,
    });
    console.log(
      `  完成 ${details.id} -> ${verdict.result.status} ${verdict.result.score}/${verdict.result.maxScore}`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "模拟评测异常";
    await report(backendId, ticket, {
      state: "failed",
      reason,
      backendVersion: BACKEND_VERSION,
    });
    console.error(`  失败 ${details.id}：${reason}`);
  } finally {
    clearInterval(heartbeat);
  }
}

async function serve(backendId) {
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
      console.error(`  领活循环 ${backendId} 出错：`, error);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function main() {
  if (process.env.FOI_STUB_RUNNER !== CONFIRM) {
    throw new Error(
      `这个评测机上报的判定是假的，不反映任何真实评测。\n` +
        `  确认要这么做，就设置 FOI_STUB_RUNNER=${CONFIRM}。\n` +
        `  真实比赛请用 foi-runners；本机开发想真的编译运行，用 pnpm backend:mock。`,
    );
  }

  // 早失败：密钥缺失要在启动时就报出来，而不是等第一次领活。
  for (const id of BACKEND_IDS) secretFor(id);

  console.log(`模拟评测机 ${RUNNER_ID}`);
  console.log(`  平台 ${KERNEL_URL}，队列 ${BACKEND_IDS.join("、")}`);
  console.log(`  并发 ${CAPACITY}/队列，领活间隔 ${POLL_INTERVAL_MS}ms`);
  console.log(`  ${SIMULATION_NOTE}`);

  for (const id of BACKEND_IDS) void serve(id);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`启动失败：${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

// 供测试比对签名算法与判定形状。
module.exports = { sign, verdictFor, main, SIMULATION_NOTE };
