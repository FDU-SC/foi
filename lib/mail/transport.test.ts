import { afterEach, describe, expect, it, vi } from "vitest";
import { mailIsConfigured, relayOptions } from "./transport";

/**
 * The relay is reached over somebody else's network, and what travels to it is
 * a verification code, a password reset link and the relay's own password.
 *
 * Nodemailer left to itself upgrades a connection only when the server says it
 * can, which means a stripped advertisement downgrades the whole exchange to
 * plaintext and reports a successful send. These cases pin the flag that turns
 * that from a preference into a requirement, and pin the one door left open in
 * it — the local Mailpit, which speaks no STARTTLS and is the mail setup a
 * fresh checkout is pointed at.
 *
 * Every case stubs the whole SMTP block rather than only the variable it is
 * about, so a `.env.local` on somebody's disk cannot change an answer.
 */
const NO_RELAY = {
  FOI_SMTP_HOST: undefined,
  FOI_SMTP_PORT: undefined,
  FOI_SMTP_USER: undefined,
  FOI_SMTP_PASSWORD: undefined,
  FOI_SMTP_SECURE: undefined,
  FOI_SMTP_ALLOW_INSECURE: undefined,
} as const;

function withEnv(overrides: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries({ ...NO_RELAY, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("未配置中继时", () => {
  it("没有可用的传输选项，邮件走控制台", () => {
    withEnv({});

    expect(relayOptions()).toBeNull();
    expect(mailIsConfigured()).toBe(false);
  });

  it("只有 host 决定配没配，端口和账号都不算", () => {
    withEnv({ FOI_SMTP_PORT: "465", FOI_SMTP_USER: "someone" });

    expect(mailIsConfigured()).toBe(false);
  });
});

describe("配置了中继时强制 STARTTLS", () => {
  it("587 上要求升级，而不是有就用、没有就算了", () => {
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });

    expect(relayOptions()).toMatchObject({ secure: false, requireTLS: true });
  });

  it("默认端口是 587", () => {
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });

    expect(relayOptions()?.port).toBe(587);
  });

  it("隐式 TLS 不叠加 STARTTLS——465 从第一个字节就是密文", () => {
    withEnv({
      FOI_SMTP_HOST: "smtp.example.com",
      FOI_SMTP_PORT: "465",
      FOI_SMTP_SECURE: "true",
    });

    expect(relayOptions()).toMatchObject({ secure: true, requireTLS: false });
  });

  it("凭据原样带上，没有用户名时不传 auth", () => {
    withEnv({
      FOI_SMTP_HOST: "smtp.example.com",
      FOI_SMTP_USER: "postmaster",
      FOI_SMTP_PASSWORD: "hunter2",
    });
    expect(relayOptions()?.auth).toEqual({
      user: "postmaster",
      pass: "hunter2",
    });

    vi.unstubAllEnvs();
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
    expect(relayOptions()?.auth).toBeUndefined();
  });
});

describe("本机 Mailpit 的例外", () => {
  it("显式放行后才允许明文", () => {
    withEnv({
      FOI_SMTP_HOST: "localhost",
      FOI_SMTP_PORT: "1025",
      FOI_SMTP_ALLOW_INSECURE: "true",
    });

    expect(relayOptions()).toMatchObject({ requireTLS: false });
  });

  /**
   * The safe posture is what a deployment gets for doing nothing, so the only
   * way out is the exact string — a typo, a `1`, or a leftover `false` all
   * leave the requirement standing rather than silently lifting it.
   */
  it("只有精确的 \"true\" 能放行", () => {
    for (const value of ["1", "yes", "TRUE", "false", ""]) {
      vi.unstubAllEnvs();
      withEnv({
        FOI_SMTP_HOST: "localhost",
        FOI_SMTP_ALLOW_INSECURE: value,
      });

      expect(relayOptions()).toMatchObject({ requireTLS: true });
    }
  });
});
