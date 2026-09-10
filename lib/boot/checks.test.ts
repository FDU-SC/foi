import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertEnv: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  refuse: vi.fn((_header: string, _items: string[]): never => {
    throw new Error("refused");
  }),
  releaseSha: vi.fn(() => null as string | null),
  tier: vi.fn(() => "dev" as "dev" | "prod"),
  placeholderSecrets: vi.fn(() => [] as string[]),
  backendsSharingSecret: vi.fn(() => [] as string[]),
  backendsMissingActionUrl: vi.fn(() => [] as string[]),
  undeclaredBackends: vi.fn(() => [] as string[]),
  problemsServedBy: vi.fn(() => [] as string[]),
  mailDeliveryComplaints: vi.fn(() => [] as string[]),
  mailTemplateWarnings: vi.fn(() => [] as string[]),
  enrollmentPrivilegeViolations: vi.fn(() => [] as string[]),
  enrollmentWarnings: vi.fn(() => [] as string[]),
  catalogueComplaints: vi.fn(() => [] as string[]),
  orphanedProblemComplaints: vi.fn(() => [] as string[]),
  catalogueWarnings: vi.fn(() => [] as string[]),
  contestWarnings: vi.fn(() => [] as string[]),
  assertPolicyRegistry: vi.fn(),
  policyWarnings: vi.fn(() => [] as string[]),
}));

vi.mock("@/lib/env", () => ({ assertEnv: mocks.assertEnv }));
vi.mock("@/lib/log", () => ({
  log: { info: mocks.info, warn: mocks.warn },
  refuse: mocks.refuse,
}));
vi.mock("./deployment", () => ({
  TIERS: ["dev", "prod"],
  releaseSha: mocks.releaseSha,
  tier: mocks.tier,
}));
vi.mock("./secrets", () => ({
  placeholderSecrets: mocks.placeholderSecrets,
}));
vi.mock("@/lib/backend/boot", () => ({
  backendsSharingSecret: mocks.backendsSharingSecret,
  backendsMissingActionUrl: mocks.backendsMissingActionUrl,
}));
vi.mock("@/lib/backend/access", () => ({
  undeclaredBackends: mocks.undeclaredBackends,
  problemsServedBy: mocks.problemsServedBy,
}));
vi.mock("@/lib/mail/transport", () => ({
  mailDeliveryComplaints: mocks.mailDeliveryComplaints,
}));
vi.mock("@/lib/mail/registry", () => ({
  mailTemplateWarnings: mocks.mailTemplateWarnings,
}));
vi.mock("@/lib/enrollment/registry", () => ({
  enrollmentPrivilegeViolations: mocks.enrollmentPrivilegeViolations,
  enrollmentWarnings: mocks.enrollmentWarnings,
}));
vi.mock("@/lib/contests/warnings", () => ({
  catalogueComplaints: mocks.catalogueComplaints,
  orphanedProblemComplaints: mocks.orphanedProblemComplaints,
  catalogueWarnings: mocks.catalogueWarnings,
  contestWarnings: mocks.contestWarnings,
}));
vi.mock("@/lib/authz/registry", () => ({
  assertPolicyRegistry: mocks.assertPolicyRegistry,
}));
vi.mock("@/lib/authz/introspect", () => ({
  policyWarnings: mocks.policyWarnings,
}));

import { assertBootConfiguration, savedBootWarnings } from "./checks";

const complaintMocks = [
  mocks.placeholderSecrets,
  mocks.backendsSharingSecret,
  mocks.backendsMissingActionUrl,
  mocks.mailDeliveryComplaints,
  mocks.mailTemplateWarnings,
  mocks.enrollmentPrivilegeViolations,
  mocks.enrollmentWarnings,
  mocks.catalogueComplaints,
  mocks.orphanedProblemComplaints,
  mocks.catalogueWarnings,
  mocks.contestWarnings,
  mocks.policyWarnings,
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const check of complaintMocks) check.mockReturnValue([]);
  mocks.undeclaredBackends.mockReturnValue([]);
  mocks.problemsServedBy.mockReturnValue([]);
  mocks.releaseSha.mockReturnValue(null);
  mocks.tier.mockReturnValue("dev");
  mocks.refuse.mockImplementation((_header, _items): never => {
    throw new Error("refused");
  });
  globalThis.__foiBootWarnings = undefined;
});

describe("启动检查编排", () => {
  it("dev 将仅生产致命的问题保存并记录为警告", async () => {
    mocks.placeholderSecrets.mockReturnValue(["使用了占位密钥"]);

    await expect(assertBootConfiguration()).resolves.toBeUndefined();

    expect(savedBootWarnings()).toEqual(["使用了占位密钥"]);
    expect(mocks.warn).toHaveBeenCalledWith("使用了占位密钥");
    expect(mocks.refuse).not.toHaveBeenCalled();
  });

  it("prod 拒绝仅生产致命的问题，同时保留普通警告", async () => {
    mocks.tier.mockReturnValue("prod");
    mocks.placeholderSecrets.mockReturnValue(["使用了占位密钥"]);
    mocks.contestWarnings.mockReturnValue(["比赛配置提醒"]);

    await expect(assertBootConfiguration()).rejects.toThrow("refused");

    expect(mocks.refuse).toHaveBeenCalledWith("配置不完整（环境 prod）:", [
      "使用了占位密钥",
    ]);
    expect(savedBootWarnings()).toEqual(["比赛配置提醒"]);
    expect(mocks.warn).toHaveBeenCalledWith("比赛配置提醒");
  });

  it.each(["dev", "prod"] as const)(
    "%s 均拒绝违反平台不变量的配置",
    async (tier) => {
      mocks.tier.mockReturnValue(tier);
      mocks.catalogueComplaints.mockReturnValue(["题库路由冲突"]);

      await expect(assertBootConfiguration()).rejects.toThrow("refused");

      expect(mocks.refuse).toHaveBeenCalledWith(
        `配置不完整（环境 ${tier}）:`,
        ["题库路由冲突"],
      );
    },
  );

  it("成功检查会清除旧警告，并校验环境与策略注册表", async () => {
    globalThis.__foiBootWarnings = ["旧警告"];

    await assertBootConfiguration();

    expect(savedBootWarnings()).toEqual([]);
    expect(mocks.assertEnv).toHaveBeenCalledOnce();
    expect(mocks.assertPolicyRegistry).toHaveBeenCalledOnce();
  });
});
