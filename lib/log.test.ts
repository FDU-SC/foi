import { afterEach, describe, expect, it, vi } from "vitest";
import { log, refuse } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

function records(write: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return write.mock.calls
    .map(([chunk]) => String(chunk).trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("操作员日志", () => {
  it("写成带 name 与级别的 JSON，标识符放在字段里", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const cause = new Error("connection refused");

    log.info({ env: "dev" }, "进程已启动");
    log.warn("配置缺失");
    log.error({ err: cause }, "数据库不可达");

    const lines = records(write);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      name: "foi",
      level: "info",
      env: "dev",
      msg: "进程已启动",
    });
    expect(lines[1]).toMatchObject({
      name: "foi",
      level: "warn",
      msg: "配置缺失",
    });
    expect(lines[2]).toMatchObject({
      name: "foi",
      level: "error",
      msg: "数据库不可达",
    });
    expect(lines[2].err).toMatchObject({ type: "Error", message: "connection refused" });
  });

  it("没有字段时只写消息", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    log.error("启动失败");

    expect(records(write)[0]).toMatchObject({
      name: "foi",
      level: "error",
      msg: "启动失败",
    });
  });
});

describe("refuse", () => {
  it("把全部问题汇总为带前缀和缩进的错误", () => {
    expect(() =>
      refuse("配置不完整：", ["DATABASE_URL 未设置", "AUTH_SECRET 太短"]),
    ).toThrow(
      new Error(
        "[foi] 配置不完整：\n" +
          "  - DATABASE_URL 未设置\n" +
          "  - AUTH_SECRET 太短",
      ),
    );
  });
});
