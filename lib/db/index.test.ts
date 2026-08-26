import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The contract `next build` relies on: loading this module must not read
 * `DATABASE_URL`. First use still throws the same error the eager pool used
 * to throw at import, so a request that somehow outran `assertEnv` fails the
 * same way.
 */
describe("lib/db 惰性初始化", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    globalThis.__foiPool = undefined;
    globalThis.__foiDb = undefined;
  });

  async function loadWithoutUrl() {
    vi.stubEnv("DATABASE_URL", "");
    globalThis.__foiPool = undefined;
    globalThis.__foiDb = undefined;
    vi.resetModules();
    return import("./index");
  }

  it("没有 DATABASE_URL 时 import 不抛", async () => {
    await expect(loadWithoutUrl()).resolves.toBeDefined();
  });

  it("第一次使用才要求 DATABASE_URL", async () => {
    const { db, pool } = await loadWithoutUrl();
    expect(() => db.select).toThrow(/缺少环境变量 DATABASE_URL/);
    expect(() => pool.query).toThrow(/缺少环境变量 DATABASE_URL/);
  });
});
