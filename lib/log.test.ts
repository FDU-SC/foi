import { afterEach, describe, expect, it, vi } from "vitest";
import { log, refuse } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("操作员日志", () => {
  it("各级别写入对应输出，并统一添加前缀", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("connection refused");

    log.info("服务已启动");
    log.warn("配置缺失");
    log.error("数据库不可达", cause);

    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith("[foi] 服务已启动");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("[foi] 配置缺失");
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("[foi] 数据库不可达", cause);
  });

  it("没有原因时不向错误输出追加 undefined", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    log.error("启动失败");

    expect(error).toHaveBeenCalledWith("[foi] 启动失败");
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
