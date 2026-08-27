import { describe, expect, it } from "vitest";
import { emailChange, resetPassword, verificationLink } from "./index";

const EXPIRES = new Date("2026-03-01T04:05:00Z");

describe("verificationLink", () => {
  const mail = verificationLink({
    url: "https://foi.example.test/register?token=abc123",
    expiresAt: EXPIRES,
  });

  it("链接同时作为按钮和纯文本给出", () => {
    expect(mail.text).toContain(
      "https://foi.example.test/register?token=abc123",
    );
    expect(mail.html).toContain('href="https://foi.example.test/register');
  });

  it("给出有效期，按东八区呈现", () => {
    expect(mail.text).toContain("12:05");
    expect(mail.html).toContain("12:05");
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

describe("emailChange", () => {
  it("新邮箱和链接都在正文里", () => {
    const mail = emailChange({
      displayName: "李四",
      newEmail: "new@example.test",
      url: "https://foi.example.test/settings/email/confirm?token=xyz",
      expiresAt: EXPIRES,
    });

    expect(mail.text).toContain("new@example.test");
    expect(mail.text).toContain(
      "https://foi.example.test/settings/email/confirm?token=xyz",
    );
    expect(mail.html).toContain("new@example.test");
    expect(mail.html).toContain('href="https://foi.example.test/settings/email/confirm');
  });
});
