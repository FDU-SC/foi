import { describe, expect, it } from "vitest";
import { sessionMatchesPassword } from "./password";

describe("sessionMatchesPassword", () => {
  it("账号没有密码就判定失效", () => {
    expect(sessionMatchesPassword(null, Date.now())).toBe(false);
  });

  it("会话签发时刻等于改密时刻算有效", () => {

    const now = new Date();

    expect(sessionMatchesPassword(now, now.getTime())).toBe(true);
  });

  it("改密晚于会话签发就判定失效", () => {
    const issued = new Date("2026-01-01T00:00:00.000Z");
    const changed = new Date("2026-01-01T00:00:00.001Z");

    expect(sessionMatchesPassword(changed, issued.getTime())).toBe(false);
  });

  it("改密早于会话签发仍然有效", () => {
    const changed = new Date("2026-01-01T00:00:00.000Z");
    const issued = new Date("2026-06-01T00:00:00.000Z");

    expect(sessionMatchesPassword(changed, issued.getTime())).toBe(true);
  });

  it("旧 token 的 passwordAt 缺省为 0，一律判定失效", () => {
    expect(sessionMatchesPassword(new Date(), 0)).toBe(false);
  });
});
