import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertMailDelivery,
  mailIsConfigured,
  mailSink,
  relayOptions,
} from "./transport";

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
  vi.restoreAllMocks();
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

/**
 * `policy.mailDelivery` against the environment it lands in.
 *
 * The two functions are exercised together because neither settles the
 * question alone: the policy says what the deployment meant, the environment
 * says what it has, and every case worth pinning is a disagreement between
 * them. Both take the delivery as an argument rather than reading the registry
 * — `content/enrollment/` is a real file a test cannot edit, so passing it is
 * the only way to reach the declared-`console` half at all.
 */
describe("声明的投递方式与环境不一致时", () => {
  it("声明 console 就走控制台，配没配中继都一样", () => {
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
    expect(mailSink("console")).toBe("console");

    vi.unstubAllEnvs();
    withEnv({});
    expect(mailSink("console")).toBe("console");
  });

  it("声明 console 时生产环境也不拦", () => {
    withEnv({});
    vi.stubEnv("NODE_ENV", "production");

    expect(() => assertMailDelivery("console")).not.toThrow();
  });

  it("声明 smtp 且配了中继就真的投递", () => {
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
    vi.stubEnv("NODE_ENV", "production");

    expect(() => assertMailDelivery("smtp")).not.toThrow();
    expect(mailSink("smtp")).toBe("smtp");
  });

  it("生产环境声明了 smtp 却没有中继时拒绝启动", () => {
    withEnv({});
    vi.stubEnv("NODE_ENV", "production");

    expect(() => assertMailDelivery("smtp")).toThrow(/FOI_SMTP_HOST/);
  });

  /**
   * The fresh-checkout bargain. `content/enrollment/example.ts` names no
   * `mailDelivery` and so inherits `smtp`, so enforcing everywhere would stop
   * the one setup the README points a newcomer at from starting at all. What
   * the warning buys is that the fallback is no longer silent — which is the
   * whole complaint the field was added to answer.
   */
  it("非生产环境缺中继时回落到控制台，但会说出来", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    withEnv({});
    vi.stubEnv("NODE_ENV", "development");

    expect(() => assertMailDelivery("smtp")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(mailSink("smtp")).toBe("console");
  });

  /**
   * `assertMailDelivery` runs once at startup and `mailSink` runs per message,
   * so the second cannot lean on the first having happened: a process started
   * some other way would otherwise print reset links to the container log,
   * which is the exact failure the pair exists to stop.
   */
  it("生产环境即便绕过了启动校验，投递也不会退回控制台", () => {
    withEnv({});
    vi.stubEnv("NODE_ENV", "production");

    expect(() => mailSink("smtp")).toThrow(/FOI_SMTP_HOST/);
  });
});
