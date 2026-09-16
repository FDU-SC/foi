import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { resolveBackend } from "./resolve";

describe("密钥优先级", () => {
  const id = Object.keys(backends)[0];
  let saved: ProblemBackend;

  beforeEach(() => {
    vi.stubEnv("FOI_BACKEND_SECRET", "test-secret");
    saved = backends[id];
  });

  afterEach(() => {
    backends[id] = saved;
    vi.unstubAllEnvs();
  });

  it("专属密钥压过共享密钥", () => {
    backends[id] = { ...saved, secret: "dedicated-key" };

    expect(resolveBackend(id).secret).toBe("dedicated-key");
  });

  it("没有专属密钥时回落到共享密钥", () => {
    backends[id] = { ...saved, secret: undefined };

    expect(resolveBackend(id).secret).toBe("test-secret");
  });

  it("未登记的后端解析不出来", () => {
    expect(() => resolveBackend("no-such-backend")).toThrow(
      '未知的题目后端 "no-such-backend"',
    );
  });
});
