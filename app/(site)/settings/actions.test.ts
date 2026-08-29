import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedUser } from "@/lib/accounts/types";

const mocks = vi.hoisted(() => ({
  viewer: null as ResolvedUser | null,
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
  signIn: vi.fn(),
  getAccount: vi.fn(),
  getAccountByUsername: vi.fn(),
  updateNickname: vi.fn(),
  updateUsername: vi.fn(),
  setPassword: vi.fn(),
  verifyPassword: vi.fn(),
  sendSecurityNotice: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth", () => ({
  getResolvedUser: () => Promise.resolve(mocks.viewer),
  signIn: mocks.signIn,
}));
vi.mock("@/lib/accounts/queries", () => ({
  getAccount: mocks.getAccount,
  getAccountByUsername: mocks.getAccountByUsername,
  updateNickname: mocks.updateNickname,
  updateUsername: mocks.updateUsername,
}));
vi.mock("@/lib/accounts/password", () => ({
  setPassword: mocks.setPassword,
  verifyPassword: mocks.verifyPassword,
}));
vi.mock("@/lib/mail/notify", () => ({
  sendSecurityNotice: mocks.sendSecurityNotice,
}));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.rateLimit }));

const { updateUsernameAction } = await import("./actions");

const VIEWER: ResolvedUser = {
  uid: 42,
  username: "before",
  nickname: "Tester",
  email: "tester@example.test",
  emailVerified: true,
  groups: [],
  status: "active",
  disabled: false,
};

function form(username = "after", currentPassword = "correct-password"): FormData {
  const data = new FormData();
  data.set("username", username);
  data.set("currentPassword", currentPassword);
  return data;
}

describe("updateUsernameAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer = { ...VIEWER };
    mocks.rateLimit.mockReturnValue({ ok: true });
    mocks.getAccount.mockResolvedValue({ usernameChangedAt: null });
    mocks.verifyPassword.mockResolvedValue({
      ok: true,
      setAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.getAccountByUsername.mockResolvedValue(undefined);
    mocks.updateUsername.mockResolvedValue({ ok: true, account: {} });
    mocks.sendSecurityNotice.mockResolvedValue(undefined);
  });

  it("匿名请求重定向到登录页，且不会读取或修改账号", async () => {
    mocks.viewer = null;

    await expect(updateUsernameAction({}, form())).rejects.toThrow(
      "redirect:/login",
    );

    expect(mocks.getAccount).not.toHaveBeenCalled();
    expect(mocks.updateUsername).not.toHaveBeenCalled();
  });

  it("缺少当前密码时在访问数据库前拒绝", async () => {
    const result = await updateUsernameAction({}, form("after", ""));

    expect(result).toEqual({ error: "请输入当前密码" });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.getAccount).not.toHaveBeenCalled();
  });

  it("冷却期未结束时不校验密码也不修改用户名", async () => {
    mocks.getAccount.mockResolvedValue({ usernameChangedAt: new Date() });

    const result = await updateUsernameAction({}, form());

    expect(result.error).toContain("用户名每 30 天只能修改一次");
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.updateUsername).not.toHaveBeenCalled();
  });

  it("当前密码错误时不检查占用状态也不修改用户名", async () => {
    mocks.verifyPassword.mockResolvedValue({ ok: false });

    await expect(updateUsernameAction({}, form())).resolves.toEqual({
      error: "当前密码不正确。",
    });

    expect(mocks.getAccountByUsername).not.toHaveBeenCalled();
    expect(mocks.updateUsername).not.toHaveBeenCalled();
  });

  it("预检查后发生唯一键竞争时仍返回用户名已占用", async () => {
    mocks.updateUsername.mockResolvedValue({ ok: false, reason: "taken" });

    await expect(updateUsernameAction({}, form())).resolves.toEqual({
      error: "这个用户名已被占用，换一个试试。",
    });

    expect(mocks.getAccountByUsername).toHaveBeenCalledWith("after");
    expect(mocks.updateUsername).toHaveBeenCalledWith(VIEWER.uid, "after");
    expect(mocks.sendSecurityNotice).not.toHaveBeenCalled();
  });

  it("成功时只修改会话账号并向原邮箱发送安全通知", async () => {
    await expect(updateUsernameAction({}, form())).resolves.toEqual({
      message: "用户名已更新为 after，下次登录请使用新用户名。",
    });

    expect(mocks.updateUsername).toHaveBeenCalledWith(VIEWER.uid, "after");
    expect(mocks.sendSecurityNotice).toHaveBeenCalledWith(
      {
        uid: VIEWER.uid,
        nickname: VIEWER.nickname,
        email: VIEWER.email,
      },
      "username",
      "新用户名：after",
    );
  });
});
