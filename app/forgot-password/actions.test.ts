import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedUser } from "@/lib/accounts/types";
import type { AccountRow } from "@/lib/db/schema";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

const mocks = vi.hoisted(() => ({
  allows: vi.fn(),
  findAccountByEmail: vi.fn(),
  getAccountByUsername: vi.fn(),
  getPasswordFingerprint: vi.fn(),
  getViewer: vi.fn(),
  headers: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  rateLimitBySource: vi.fn(),
  resolveFromRow: vi.fn(),
  sendPasswordReset: vi.fn(),
  sourceFrom: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/accounts/password", () => ({
  getPasswordFingerprint: mocks.getPasswordFingerprint,
}));
vi.mock("@/lib/accounts/queries", () => ({
  findAccountByEmail: mocks.findAccountByEmail,
  getAccountByUsername: mocks.getAccountByUsername,
}));
vi.mock("@/lib/accounts/resolve", () => ({
  resolveFromRow: mocks.resolveFromRow,
}));
vi.mock("@/lib/authz/engine", () => ({ allows: mocks.allows }));
vi.mock("@/lib/log", () => ({
  log: { error: mocks.logError, info: mocks.logInfo },
}));
vi.mock("@/lib/mail/notify", () => ({
  sendPasswordReset: mocks.sendPasswordReset,
}));
vi.mock("@/lib/ratelimit", () => ({
  rateLimitBySource: mocks.rateLimitBySource,
  sourceFrom: mocks.sourceFrom,
}));

const { requestPasswordReset } = await import("./actions");

const NOW = new Date("2026-09-18T00:00:00Z");
const ROW = {
  uid: 42,
  username: "alice",
  usernameChangedAt: null,
  nickname: "Alice",
  avatarUpdatedAt: null,
  email: "alice@example.test",
  passwordSetAt: NOW,
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
} satisfies AccountRow;
const USER = {
  uid: ROW.uid,
  username: ROW.username,
  nickname: ROW.nickname,
  avatarUpdatedAt: null,
  email: ROW.email,
  emailVerified: true,
  groups: [],
  status: "active",
  disabled: false,
} satisfies ResolvedUser;
const VIEWER = { uid: null, groups: [], authenticated: false };
const SENT = {
  message: "如果该账号存在且已验证邮箱，我们已经发送了重置链接，请查收。",
};

function form(identifier: string): FormData {
  const data = new FormData();
  data.set("identifier", identifier);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ "x-real-ip": "203.0.113.10" }));
  mocks.sourceFrom.mockReturnValue("203.0.113.10");
  mocks.rateLimitBySource.mockReturnValue({ ok: true });
  mocks.getViewer.mockResolvedValue(VIEWER);
  mocks.getAccountByUsername.mockResolvedValue(undefined);
  mocks.findAccountByEmail.mockResolvedValue(undefined);
  mocks.resolveFromRow.mockReturnValue(USER);
  mocks.allows.mockReturnValue(true);
  mocks.getPasswordFingerprint.mockResolvedValue("fingerprint");
  mocks.sendPasswordReset.mockResolvedValue(undefined);
});

describe("requestPasswordReset", () => {
  it("限流拒绝时不查询账号或执行邮件副作用", async () => {
    mocks.rateLimitBySource.mockReturnValue({
      ok: false,
      retryAfterMs: 60_000,
    });

    const result = await requestPasswordReset({}, form("alice"));

    expect(result).toEqual({ error: "请求过于频繁，请稍后再试。" });
    expect(mocks.rateLimitBySource).toHaveBeenCalledWith(
      "forgot",
      "203.0.113.10",
      ACTION_LIMITS.requestPasswordReset.max,
      ACTION_LIMITS.requestPasswordReset.windowSeconds * 1_000,
    );
    expect(mocks.getAccountByUsername).not.toHaveBeenCalled();
    expect(mocks.getViewer).not.toHaveBeenCalled();
    expect(mocks.getPasswordFingerprint).not.toHaveBeenCalled();
    expect(mocks.sendPasswordReset).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "账号不存在",
      row: undefined,
      user: undefined,
      allowed: true,
    },
    {
      label: "账号已被封禁",
      row: ROW,
      user: { ...USER, status: "suspended", disabled: true } satisfies ResolvedUser,
      allowed: false,
    },
  ])("$label 时静默返回通用结果且不发送邮件", async ({
    row,
    user,
    allowed,
  }) => {
    mocks.getAccountByUsername.mockResolvedValue(row);
    if (user) mocks.resolveFromRow.mockReturnValue(user);
    mocks.allows.mockReturnValue(allowed);

    const result = await requestPasswordReset({}, form("alice"));

    expect(result).toEqual(SENT);
    expect(mocks.getPasswordFingerprint).not.toHaveBeenCalled();
    expect(mocks.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("授权通过后使用当前密码指纹发送重置链接", async () => {
    mocks.getAccountByUsername.mockResolvedValue(ROW);

    const result = await requestPasswordReset({}, form("alice"));

    expect(result).toEqual(SENT);
    expect(mocks.allows).toHaveBeenCalledWith(
      "account.sendPasswordReset",
      USER,
      VIEWER,
    );
    expect(mocks.getPasswordFingerprint).toHaveBeenCalledWith(ROW.uid);
    expect(mocks.sendPasswordReset).toHaveBeenCalledWith(
      { uid: ROW.uid, nickname: ROW.nickname, email: ROW.email },
      "fingerprint",
    );
    expect(mocks.logInfo).toHaveBeenCalledWith(
      `找回密码: 已向 uid=${ROW.uid} 发出重置链接`,
    );
  });

  it("邮件发送失败时仍返回通用结果", async () => {
    const error = new Error("SMTP unavailable");
    mocks.getAccountByUsername.mockResolvedValue(ROW);
    mocks.sendPasswordReset.mockRejectedValue(error);

    const result = await requestPasswordReset({}, form("alice"));

    expect(result).toEqual(SENT);
    expect(mocks.logError).toHaveBeenCalledWith(
      `找回密码: 向 uid=${ROW.uid} 投递重置邮件失败`,
      error,
    );
  });
});
