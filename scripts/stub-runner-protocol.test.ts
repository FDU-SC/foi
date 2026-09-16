import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifySignature } from "@/lib/backend/signature";

const SCRIPT = fileURLToPath(new URL("./stub-runner.cjs", import.meta.url));
const SECRET = "test-only-stub-runner-protocol-secret";
const BACKEND = "a-backend";
const RUNNER = "a-runner";

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    FOI_BACKEND_SECRET: SECRET,
    FOI_STUB_BACKENDS: BACKEND,
    FOI_STUB_RUNNER_ID: RUNNER,
    FOI_STUB_CAPACITY: "1",
    FOI_STUB_POLL_INTERVAL: "20",
    FOI_STUB_HEARTBEAT_INTERVAL: "20",
    FOI_STUB_DELAY: "200",
  };
}

describe("stub-runner 的进程协议", () => {
  it.each([undefined, "yes"])("未显式启用（%s）时拒绝启动", (confirmation) => {
    const env = environment();
    if (confirmation !== undefined) env.FOI_STUB_RUNNER = confirmation;
    const result = spawnSync(process.execPath, [SCRIPT], {
      env,
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FOI_STUB_RUNNER=yes-fake-verdicts");
  });

  it("生产环境中签名领取任务、携带 lease 获取详情、心跳并上报模拟结果", async () => {
    const ticket = { id: "a-job/1", lease: "a-lease/+?" };
    const path = `/api/runner/jobs/${encodeURIComponent(ticket.id)}`;
    let claimed = false;
    let fetched = false;
    let heartbeats = 0;
    let output = "";
    const finished = Promise.withResolvers<void>();

    const kernel = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString();
        expect(verifySignature({
          secret: SECRET,
          timestamp: request.headers["x-foi-timestamp"]?.toString() ?? null,
          signature: request.headers["x-foi-signature"]?.toString() ?? null,
          request: { method: request.method ?? "", path: request.url ?? "", body },
        })).toEqual({ ok: true });

        if (request.method === "POST" && request.url === "/api/runner/jobs/request") {
          expect(JSON.parse(body)).toEqual({
            backendId: BACKEND,
            runnerId: RUNNER,
            nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
          });
          if (claimed) {
            response.writeHead(204).end();
            return;
          }
          claimed = true;
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(ticket));
          return;
        }

        if (request.method === "GET" && request.url === `${path}?lease=${encodeURIComponent(ticket.lease)}`) {
          expect(claimed).toBe(true);
          expect(body).toBe("");
          fetched = true;
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
            id: ticket.id,
            user: { uid: 1, groups: [] },
            problem: { slug: "a-problem", config: {} },
            contestSlug: "a-contest",
            payload: { source: "a submission for simulation" },
          }));
          return;
        }

        expect(request.method).toBe("PUT");
        expect(request.url).toBe(path);
        expect(fetched).toBe(true);
        const report = JSON.parse(body);
        expect(report.lease).toBe(ticket.lease);
        if (report.state === "alive") {
          expect(report.status).toBe("模拟评测中");
          heartbeats += 1;
        } else {
          expect(heartbeats).toBeGreaterThan(0);
          expect(report).toMatchObject({
            state: "done",
            backendVersion: "stub-demo",
            verdict: {
              result: {
                status: expect.any(String),
                score: expect.any(Number),
                maxScore: 100,
                accepted: expect.any(Boolean),
              },
              detail: {
                tests: expect.any(Array),
                message: "模拟评测结果，按提交内容的哈希生成；未编译或运行代码。",
              },
            },
          });
        }
        response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        if (report.state === "done") finished.resolve();
      } catch (error) {
        response.writeHead(500).end();
        finished.reject(error);
      }
    });
    kernel.requestTimeout = 2_000;
    await new Promise<void>((resolve, reject) => {
      kernel.once("error", reject);
      kernel.listen(0, "127.0.0.1", resolve);
    });

    const runner = spawn(process.execPath, [SCRIPT], {
      env: {
        ...environment(),
        FOI_STUB_RUNNER: "yes-fake-verdicts",
        FOI_KERNEL_URL: `http://127.0.0.1:${(kernel.address() as { port: number }).port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    runner.stdout.on("data", (chunk) => { output += chunk; });
    runner.stderr.on("data", (chunk) => { output += chunk; });
    runner.once("error", finished.reject);
    const closed = new Promise<void>((resolve) => {
      runner.once("close", (code, signal) => {
        finished.reject(new Error(`模拟评测机提前退出（${code ?? signal}）\n${output}`));
        resolve();
      });
    });
    const timeout = setTimeout(() => {
      finished.reject(new Error(`等待模拟评测结果超时\n${output}`));
    }, 5_000);

    try {
      await finished.promise;
    } finally {
      clearTimeout(timeout);
      runner.kill("SIGTERM");
      const forceKill = setTimeout(() => { runner.kill("SIGKILL"); }, 1_000);
      try {
        await closed;
      } finally {
        clearTimeout(forceKill);
        kernel.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          kernel.close((error) => error ? reject(error) : resolve());
        });
      }
    }
  }, 10_000);
});
