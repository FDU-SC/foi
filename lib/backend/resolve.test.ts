import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { resolveBackend } from "./resolve";

/**
 * `resolveBackend` needed no change to support per-backend keys — the
 * `entry.secret || FOI_BACKEND_SECRET` chain was written for them long before
 * `content/backends.ts` ever filled `secret` in. Pinned here because that makes
 * the precedence load-bearing rather than incidental: get it backwards and
 * every deployment silently keeps signing with the shared value while its
 * per-backend keys sit configured and unused.
 */
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

  it("没有专属密钥时回落到共享的，本机开发才能一把跑起来", () => {
    backends[id] = { ...saved, secret: undefined };

    expect(resolveBackend(id).secret).toBe("test-secret");
  });

  it("未登记的后端解析不出来", () => {
    expect(() => resolveBackend("no-such-backend")).toThrow(/content\/backends/);
  });
});
