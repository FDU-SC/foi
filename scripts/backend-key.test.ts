import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveBackendSecret } from "@/lib/backend/keys.cjs";

const SCRIPT = fileURLToPath(new URL("./backend-key.cjs", import.meta.url));
const MASTER = "test-only-backend-key-master-secret";

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { NODE_ENV: "production", PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    timeout: 2_000,
  });
}

describe("backend-key 脚本", () => {
  it("每个后端输出一行可直接写进 .env 的派生密钥", () => {
    const result = run(["a-backend", "another-backend"], {
      FOI_BACKEND_SECRET: MASTER,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      `FOI_BACKEND_A_BACKEND_SECRET=${deriveBackendSecret(MASTER, "a-backend")}`,
      `FOI_BACKEND_ANOTHER_BACKEND_SECRET=${deriveBackendSecret(MASTER, "another-backend")}`,
    ]);
  });

  it("环境里残留的专属密钥变量不影响输出", () => {
    const result = run(["a-backend"], {
      FOI_BACKEND_SECRET: MASTER,
      FOI_BACKEND_A_BACKEND_SECRET: "leftover-key",
    });

    expect(result.stdout.trim()).toBe(
      `FOI_BACKEND_A_BACKEND_SECRET=${deriveBackendSecret(MASTER, "a-backend")}`,
    );
  });

  it("缺少主密钥时拒绝，不输出空值", () => {
    const result = run(["a-backend"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("FOI_BACKEND_SECRET");
  });

  it("不合法的后端 id 被拒绝", () => {
    const result = run(["A_Backend"], { FOI_BACKEND_SECRET: MASTER });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("A_Backend");
  });

  it("不给后端时打印用法", () => {
    const result = run([], { FOI_BACKEND_SECRET: MASTER });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("用法");
  });
});
