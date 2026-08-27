import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tier } from "@/lib/boot/deployment";
import {
  declaredDelivery,
  mailDeliveryComplaints,
  mailDeliveryUnmet,
  mailSink,
  relayOptions,
} from "./transport";

const NO_RELAY = {
  FOI_SMTP_HOST: undefined,
  FOI_SMTP_PORT: undefined,
  FOI_SMTP_USER: undefined,
  FOI_SMTP_PASSWORD: undefined,
  FOI_SMTP_SECURE: undefined,
  FOI_ENV: undefined,
  FOI_MAIL_DELIVERY: undefined,
} as const;

function withEnv(overrides: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries({ ...NO_RELAY, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

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

describe("declaredDelivery", () => {
  it("不设 FOI_MAIL_DELIVERY 时默认 smtp", () => {
    withEnv({});
    expect(declaredDelivery()).toBe("smtp");
  });

  it("显式设置 console 时返回 console", () => {
    withEnv({ FOI_MAIL_DELIVERY: "console" });
    expect(declaredDelivery()).toBe("console");
  });

  it("显式设置 smtp 时返回 smtp", () => {
    withEnv({ FOI_MAIL_DELIVERY: "smtp" });
    expect(declaredDelivery()).toBe("smtp");
  });
});

describe("邮件投递策略", () => {
  it("FOI_MAIL_DELIVERY=console 时什么都不报", () => {
    withEnv({ FOI_MAIL_DELIVERY: "console" });
    atTier("prod");

    expect(mailDeliveryComplaints()).toEqual([]);
  });

  it("smtp 且配了中继就真的投递", () => {
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
    atTier("prod");

    expect(mailDeliveryComplaints()).toEqual([]);
    expect(mailSink()).toBe("smtp");
  });

  it("smtp（默认）却没有中继时报出来", () => {
    withEnv({});
    atTier("prod");

    expect(mailDeliveryComplaints()).toHaveLength(1);
    expect(mailDeliveryComplaints()[0]).toMatch(/FOI_SMTP_HOST/);
  });

  it("dev 与 staging 缺中继时回落到控制台", () => {
    for (const tier of ["dev", "staging"] as const) {
      vi.unstubAllEnvs();
      withEnv({});
      vi.stubEnv("NODE_ENV", "production");
      atTier(tier);

      expect(mailSink()).toBe("console");
    }
  });

  it("dev 与 staging 上配了中继就仍然走中继", () => {
    for (const tier of ["dev", "staging"] as const) {
      vi.unstubAllEnvs();
      withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
      atTier(tier);

      expect(mailSink()).toBe("smtp");
    }
  });

  it("prod 即便绕过了启动校验，投递也不会退回控制台", () => {
    withEnv({});
    atTier("prod");

    expect(() => mailSink()).toThrow(/FOI_SMTP_HOST/);
  });

  it("smtp 却没有中继，是一条可以报告的分歧", () => {
    withEnv({});
    atTier("prod");

    expect(mailDeliveryUnmet()).toBe(true);
  });

  it("其余三种组合都不是分歧", () => {
    withEnv({ FOI_MAIL_DELIVERY: "console" });
    expect(mailDeliveryUnmet()).toBe(false);

    vi.unstubAllEnvs();
    withEnv({ FOI_SMTP_HOST: "smtp.example.com" });
    expect(mailDeliveryUnmet()).toBe(false);

    vi.unstubAllEnvs();
    withEnv({ FOI_SMTP_HOST: "smtp.example.com", FOI_MAIL_DELIVERY: "console" });
    expect(mailDeliveryUnmet()).toBe(false);
  });
});
