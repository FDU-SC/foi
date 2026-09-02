import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface RunnerReport {
  state: string;
  verdict?: {
    result: {
      status: string;
      score: number;
      maxScore: number;
      accepted: boolean;
    };
  };
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean);
}

async function runMpiJob(baseline?: string) {
  const tools = mkdtempSync(join(tmpdir(), "foi-mpi-test-"));
  const compiler = join(tools, "fake-mpicxx");
  const launcher = join(tools, "fake-mpirun");
  const launchLog = join(tools, "launches.log");
  const executionLog = join(tools, "executions.log");

  writeFileSync(
    compiler,
    `#!/bin/sh
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
[ -n "$output" ] || exit 2
cat > "$output" <<'PROGRAM'
#!/bin/sh
printf '%s %s\\n' "\${MPI_TEST_VIA:-direct}" "$(basename "$0")" >> "$MPI_TEST_EXECUTION_LOG"
printf '3.1415926536\\n'
PROGRAM
chmod +x "$output"
`,
  );
  chmodSync(compiler, 0o755);

  writeFileSync(
    launcher,
    `#!/bin/sh
for executable in "$@"; do :; done
printf '%s\\n' "$*" >> "$MPI_TEST_LAUNCH_LOG"
MPI_TEST_VIA=launcher "$executable"
`,
  );
  chmodSync(launcher, 0o755);

  const config: Record<string, unknown> = {
    mode: "mpi",
    n: 10,
    np: 4,
    timedRuns: 1,
    scoring: "correctness",
  };
  if (baseline !== undefined) config.baseline = baseline;

  const details = {
    id: "job-mpi-command-selection",
    user: { uid: 1, groups: [] },
    problem: { slug: "a-problem", config },
    contestSlug: null,
    payload: { source: "an MPI submission that only rank zero prints" },
  };

  let claimed = false;
  let settled = false;
  let finish!: (report: RunnerReport) => void;
  let fail!: (error: Error) => void;
  const finished = new Promise<RunnerReport>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  const kernel = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);

    if (
      request.method === "POST" &&
      request.url === "/api/runner/jobs/request"
    ) {
      if (claimed) {
        response.writeHead(204).end();
        return;
      }
      claimed = true;
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ id: details.id, lease: "lease-test" }));
      return;
    }

    if (
      request.method === "GET" &&
      request.url?.startsWith(`/api/runner/jobs/${details.id}`)
    ) {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(details));
      return;
    }

    if (
      request.method === "PUT" &&
      request.url === `/api/runner/jobs/${details.id}`
    ) {
      const report = JSON.parse(
        Buffer.concat(chunks).toString(),
      ) as RunnerReport;
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: true }));
      if (report.state === "done" || report.state === "failed") {
        settled = true;
        finish(report);
      }
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    kernel.once("error", reject);
    kernel.listen(0, "127.0.0.1", () => {
      kernel.off("error", reject);
      resolve();
    });
  });
  const address = kernel.address();
  if (!address || typeof address === "string") {
    throw new Error("test kernel did not bind a TCP port");
  }

  const runner = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/mock-runner.ts"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        MOCK_KERNEL_URL: `http://127.0.0.1:${address.port}`,
        MOCK_BACKEND_IDS: "a-backend",
        MOCK_BACKEND_CAPACITY: "1",
        MOCK_POLL_INTERVAL: "20",
        MOCK_HEARTBEAT_INTERVAL: "60000",
        MOCK_BACKEND_DELAY: "0",
        MOCK_BACKEND_PORT: "0",
        FOI_BACKEND_SECRET: "test-only-secret-with-enough-length",
        MPI_CXX: compiler,
        MPI_LAUNCHER: launcher,
        MPI_TEST_LAUNCH_LOG: launchLog,
        MPI_TEST_EXECUTION_LOG: executionLog,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  runner.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  runner.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  runner.once("exit", (code, signal) => {
    if (!settled) {
      fail(
        new Error(
          `mock runner exited before reporting (${code ?? signal})\n${stdout}\n${stderr}`,
        ),
      );
    }
  });

  const timeout = setTimeout(() => {
    fail(new Error(`timed out waiting for mock runner\n${stdout}\n${stderr}`));
  }, 10_000);

  try {
    const report = await finished;
    return {
      report,
      launchCalls: readLines(launchLog),
      executions: readLines(executionLog),
    };
  } finally {
    clearTimeout(timeout);
    if (runner.exitCode === null && runner.signalCode === null) {
      const exited = new Promise<void>((resolve) => {
        runner.once("exit", () => resolve());
      });
      runner.kill("SIGTERM");
      await exited;
    }
    await new Promise<void>((resolve, reject) => {
      kernel.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    rmSync(tools, { recursive: true, force: true });
  }
}

function expectAccepted(report: RunnerReport) {
  expect(report).toMatchObject({
    state: "done",
    verdict: {
      result: {
        status: "accepted",
        score: 100,
        maxScore: 100,
        accepted: true,
      },
    },
  });
}

describe("mock runner MPI baseline", () => {
  it("默认内置串行 baseline 单进程运行并产出正确 verdict", async () => {
    const { report, launchCalls, executions } = await runMpiJob();

    expect(launchCalls).toHaveLength(1);
    expect(launchCalls[0]).toMatch(/^-np 4 .*\/prog$/);
    expect(executions).toEqual(["direct baseline", "launcher prog"]);
    expectAccepted(report);
  }, 15_000);

  it("显式 config.baseline 仍通过 MPI launcher 运行并产出正确 verdict", async () => {
    const { report, launchCalls, executions } = await runMpiJob(
      "an explicit MPI baseline",
    );

    expect(launchCalls).toHaveLength(2);
    expect(launchCalls.every((call) => call.startsWith("-np 4 "))).toBe(true);
    expect(
      launchCalls.map((call) => basename(call.split(" ").at(-1) ?? "")),
    ).toEqual(["baseline", "prog"]);
    expect(executions).toEqual(["launcher baseline", "launcher prog"]);
    expectAccepted(report);
  }, 15_000);
});
