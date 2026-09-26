import { describe, expect, it } from "vitest";
import { SERVER_ACTION_BODY_LIMIT } from "@/lib/body-limit";
import { AVATAR_LIMITS, identiconHue, identiconInitial } from "./avatar";

describe("AVATAR_LIMITS", () => {
  it("字节上限留在 Server Action 的天花板之下", () => {
    // 超过它，请求在抵达 action 之前就被框架挡掉，用户看到的是错误边界而不是理由。
    expect(AVATAR_LIMITS.maxBytes).toBeLessThan(SERVER_ACTION_BODY_LIMIT);
  });
});

describe("identicon", () => {
  it("同一个 uid 永远得到同一个色相", () => {
    expect(identiconHue(42)).toBe(identiconHue(42));
  });

  it("色相落在一圈之内", () => {
    for (const uid of [1, 2, 7, 42, 100, 99999]) {
      expect(identiconHue(uid)).toBeGreaterThanOrEqual(0);
      expect(identiconHue(uid)).toBeLessThan(360);
    }
  });

  it("相邻的 uid 不会撞成同一个颜色", () => {
    const hues = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(identiconHue));

    expect(hues.size).toBeGreaterThan(6);
  });

  it("取首字并转成大写", () => {
    expect(identiconInitial("alice")).toBe("A");
    expect(identiconInitial("  bob")).toBe("B");
  });

  it("按码点取，emoji 和汉字都不会被切碎", () => {
    expect(identiconInitial("👍 好评")).toBe("👍");
    expect(identiconInitial("张三")).toBe("张");
  });

  it("空昵称也有东西可画", () => {
    expect(identiconInitial("")).toBe("?");
    expect(identiconInitial("   ")).toBe("?");
  });
});
