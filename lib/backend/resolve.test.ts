import { afterEach, describe, expect, it, vi } from "vitest";
import { backends } from "@/lib/backend/registry";
import { deriveBackendSecret } from "./keys.cjs";
import { resolveBackend } from "./resolve";

describe("队列密钥", () => {
  const id = Object.keys(backends)[0];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("由主密钥派生，而不是直接用主密钥", () => {
    vi.stubEnv("FOI_BACKEND_SECRET", "test-secret");

    const secret = resolveBackend(id).secret;
    expect(secret).toBe(deriveBackendSecret("test-secret", id));
    expect(secret).not.toBe("test-secret");
  });

  it("平台侧的专属密钥变量不起作用", () => {
    vi.stubEnv("FOI_BACKEND_SECRET", "test-secret");
    vi.stubEnv(`FOI_BACKEND_${id.replace(/-/g, "_").toUpperCase()}_SECRET`, "dedicated-key");

    expect(resolveBackend(id).secret).toBe(deriveBackendSecret("test-secret", id));
  });

  it("没有主密钥时解析失败，并说出该设哪个变量", () => {
    vi.stubEnv("FOI_BACKEND_SECRET", "");

    expect(() => resolveBackend(id)).toThrow("FOI_BACKEND_SECRET");
  });

  it("未登记的后端解析不出来", () => {
    vi.stubEnv("FOI_BACKEND_SECRET", "test-secret");

    expect(() => resolveBackend("no-such-backend")).toThrow(
      '未知的题目后端 "no-such-backend"',
    );
  });
});
