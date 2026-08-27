import { describe, expect, it } from "vitest";
import { resetPassword, verificationCode } from "./index";

const EXPIRES = new Date("2026-03-01T04:05:00Z");

describe("verificationCode", () => {
  const mail = verificationCode({ code: "042317", expiresAt: EXPIRES });

  it("验证码同时出现在纯文本和 HTML 两个版本里", () => {
    expect(mail.text).toContain("042317");
    expect(mail.html).toContain("042317");
  });

  it("纯文本版把验证码单独放一行，便于复制", () => {
    expect(mail.text.split("\n")).toContain("042317");
  });

  it("验证码不出现在主题里", () => {

    expect(mail.subject).not.toContain("042317");
  });

  it("给出有效期，按东八区呈现", () => {
    expect(mail.text).toContain("12:05");
    expect(mail.html).toContain("12:05");
  });

  it("不含链接：这封信要做的事就在收信人已经打开的页面上", () => {
    expect(mail.text).not.toContain("http");
    expect(mail.html).not.toContain("<a ");
  });
});

describe("resetPassword", () => {
  it("链接同时作为按钮和纯文本给出", () => {
    const mail = resetPassword({
      displayName: "张三",
      url: "https://foi.example.test/reset-password?token=abc123",
      expiresAt: EXPIRES,
    });

    expect(mail.text).toContain(
      "https://foi.example.test/reset-password?token=abc123",
    );
    expect(mail.html).toContain('href="https://foi.example.test/reset-password');

    expect(mail.html.split("reset-password?token=abc123").length).toBe(3);
  });

  it("显示名里的尖括号会被转义，而不是变成标签", () => {
    const mail = resetPassword({
      displayName: '<img src=x onerror="alert(1)">',
      url: "https://foi.example.test/reset-password?token=t",
      expiresAt: EXPIRES,
    });

    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });
});
