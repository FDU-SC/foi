import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/boot/deployment";
import {
  defaultedMailDeliveryComplaints,
  mailDeliveryComplaints,
  mailDeliveryUnmet,
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
 * that from a preference into a requirement. There is no longer a door left
 * open in it: the exception existed for a local Mailpit and both are gone, so
 * "I want to read the mail locally" is answered by the console sink instead.
 *
 * Every case stubs the whole SMTP block rather than only the variable it is
 * about, so a `.env.local` on somebody's disk cannot change an answer.
 * `FOI_ENV` is stubbed for the same reason and matters more: it now outranks
 * `NODE_ENV`, so a checkout declaring `dev` would otherwise quietly turn every
 * production case below into a development one.
 */
const NO_RELAY = {
  FOI_SMTP_HOST: undefined,
  FOI_SMTP_PORT: undefined,
  FOI_SMTP_USER: undefined,
  FOI_SMTP_PASSWORD: undefined,
  FOI_SMTP_SECURE: undefined,
  FOI_ENV: undefined,
} as const;

function withEnv(overrides: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries({ ...NO_RELAY, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

/** Says the tier in as many words, rather than through `NODE_ENV`. */
function atTier(tier: Tier): void {
  vi.stubEnv("FOI_ENV", tier);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("未配置中继时", () => {
  it("没有可用的传输选项，邮件走控制台", () => {
    withEnv({});

    expect(relayOptions()).toBeNull();
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

/**
 * Mailpit's exception is retired along with Mailpit, and nothing replaces it.
 *
 * The variable that lifted the requirement is gone rather than defaulted off,
 * because an opt-out that exists is an opt-out somebody copies into a
 * deployment — and what it buys there is a verification code, a reset link and
 * the relay's own password travelling in the clear.
 */
describe("没有明文豁免", () => {
  it("本机地址不再是例外，照样要求升级", () => {
    withEnv({ FOI_SMTP_HOST: "localhost", FOI_SMTP_PORT: "1025" });

    expect(relayOptions()).toMatchObject({ requireTLS: true });
  });

  it("那个变量已经不参与判断了", () => {
    for (const value of ["true", "1", "TRUE", "false", ""]) {
      vi.unstubAllEnvs();
      withEnv({ FOI_SMTP_HOST: "localhost" });
      vi.stubEnv("FOI_SMTP_ALLOW_INSECURE", value);

      expect(relayOptions()).toMatchObject({ requireTLS: true });
    }
  });
});

/**
 * `policy.mailDelivery` against the environment it lands in.
 *
 * The three functions are exercised together because none settles the question
 * alone: the policy says what the deployment meant, the environment says what
 * it has, and every case worth pinning is a disagreement between them. All
 * three take the delivery as an argument rather than reading the registry —
 * `content/enrollment/` is a real file a test cannot edit, so passing it is
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

  it("声明 console 时什么都不报", () => {
    withEnv({});
    atTier("prod");

    expect(mailDeliveryComplaints("console")).toEqual([]);
    expect(defaultedMailDeliveryComplaints("console", false)).toEqual([]);
  });

  it("声明 smtp 且配了中继就真的投递", () => {
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
    atTier("prod");

    expect(mailDeliveryComplaints("smtp")).toEqual([]);
    expect(mailSink("smtp")).toBe("smtp");
  });

  /**
   * The complaint no longer reads the tier — `lib/boot/checks.ts` decides
   * whether it stops a boot — so it has to be produced everywhere the shape
   * exists, including on a checkout where it is merely worth saying.
   */
  it("声明了 smtp 却没有中继，在哪一层都是一条发现", () => {
    for (const tier of ["dev", "staging", "prod"] as const) {
      vi.unstubAllEnvs();
      withEnv({});
      atTier(tier);

      expect(mailDeliveryComplaints("smtp")).toHaveLength(1);
      expect(mailDeliveryComplaints("smtp")[0]).toMatch(/FOI_SMTP_HOST/);
    }
  });

  /**
   * The same environment, one deployment that never said anything.
   *
   * `smtp` is the schema's default, so a deployment with no
   * `content/enrollment/` at all arrives here carrying a value the kernel
   * picked for it — and the complaint above opens with 「注册策略声明了」,
   * which in that case is simply untrue. Refusing that boot is the platform
   * enforcing its own default against a deployment that shipped no content,
   * and it is what stopped an empty `content/` from starting at all.
   *
   * Still says something, and says the right thing: nobody can be mailed. What
   * it does not do is turn that into an outage for a deployment with no
   * cohorts to register into.
   */
  it("完全没有 content/enrollment/ 时，报的是另一条、且两条互斥", () => {
    withEnv({});
    atTier("prod");

    expect(mailDeliveryComplaints("smtp", false)).toEqual([]);
    const defaulted = defaultedMailDeliveryComplaints("smtp", false);
    expect(defaulted).toHaveLength(1);
    expect(defaulted[0]).toMatch(/content\/enrollment\//);
  });

  /**
   * The tier decision, which is the whole reason `FOI_ENV` had to exist: the
   * image pins `NODE_ENV=production` on staging too, so on `NODE_ENV` alone
   * this case could not be told from the one below it.
   */
  it("dev 与 staging 缺中继时回落到控制台", () => {
    for (const tier of ["dev", "staging"] as const) {
      vi.unstubAllEnvs();
      withEnv({});
      vi.stubEnv("NODE_ENV", "production");
      atTier(tier);

      expect(mailSink("smtp")).toBe("console");
    }
  });

  it("dev 与 staging 上配了中继就仍然走中继", () => {
    for (const tier of ["dev", "staging"] as const) {
      vi.unstubAllEnvs();
      withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
      atTier(tier);

      expect(mailSink("smtp")).toBe("smtp");
    }
  });

  /**
   * The boot check runs once and `mailSink` runs per message, so the second
   * cannot lean on the first having happened: a process started some other way
   * would otherwise print reset links to the container log, which is the exact
   * failure the pair exists to stop.
   */
  it("prod 即便绕过了启动校验，投递也不会退回控制台", () => {
    withEnv({});
    atTier("prod");

    expect(() => mailSink("smtp")).toThrow(/FOI_SMTP_HOST/);
  });

  /**
   * The same combination the two above refuse, asked by something that only
   * wants to name it. The operations console has to report this from a page
   * that still renders, which is why it is a separate function — on this exact
   * input `mailSink` throws and the boot check refuses.
   */
  it("声明 smtp 却没有中继，是一条可以报告的分歧，生产环境下也只是报告", () => {
    withEnv({});
    atTier("prod");

    expect(mailDeliveryUnmet("smtp")).toBe(true);
  });

  /**
   * Nothing to report in the other three corners. A declaration of `console`
   * is a decision rather than drift whatever the environment happens to hold —
   * that is the whole reason the field exists — and `smtp` with a relay behind
   * it is simply a deployment that works.
   */
  it("其余三种组合都不是分歧", () => {
    withEnv({});
    expect(mailDeliveryUnmet("console")).toBe(false);

    vi.unstubAllEnvs();
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
    expect(mailDeliveryUnmet("console")).toBe(false);
    expect(mailDeliveryUnmet("smtp")).toBe(false);
  });
});
