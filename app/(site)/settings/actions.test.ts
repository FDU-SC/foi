import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

const mocks = vi.hoisted(() => ({
  avatarRejection: vi.fn(),
  clearAvatar: vi.fn(),
  rateLimit: vi.fn(),
  requireSelf: vi.fn(),
  revalidatePath: vi.fn(),
  setAvatar: vi.fn(),
}));

vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({
  requireSelf: mocks.requireSelf,
  signIn: vi.fn(),
}));

vi.mock("@/lib/accounts/avatar", () => ({
  avatarRejection: mocks.avatarRejection,
}));

vi.mock("@/lib/accounts/password", () => ({
  setPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/accounts/queries", () => ({
  clearAvatar: mocks.clearAvatar,
  getAccount: vi.fn(),
  getAccountByUsername: vi.fn(),
  setAvatar: mocks.setAvatar,
  updateNickname: vi.fn(),
  updateUsername: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  log: { error: vi.fn() },
}));

vi.mock("@/lib/mail/notify", () => ({
  sendSecurityNotice: vi.fn(),
}));

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: mocks.rateLimit,
}));

const { removeAvatarAction, updateAvatarAction } = await import("./actions");

const viewer = {
  uid: 42,
  username: "alice",
  nickname: "Alice",
  avatarUpdatedAt: new Date("2026-09-01T00:00:00Z"),
  email: null,
  emailVerified: false,
  groups: [],
  status: "active",
  disabled: false,
};

function upload(bytes: Uint8Array): FormData {
  const form = new FormData();
  form.set("avatar", new File([bytes], "avatar.webp", { type: "image/webp" }));
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSelf.mockResolvedValue(viewer);
  mocks.rateLimit.mockReturnValue({ ok: true });
  mocks.avatarRejection.mockReturnValue(null);
  mocks.setAvatar.mockResolvedValue(new Date("2026-09-08T00:00:00Z"));
  mocks.clearAvatar.mockResolvedValue(true);
});

describe("updateAvatarAction", () => {
  it("权限拒绝时不读取、校验或保存上传内容", async () => {
    const denied = new Error("forbidden");
    mocks.requireSelf.mockRejectedValue(denied);

    await expect(
      updateAvatarAction({}, upload(Uint8Array.of(1))),
    ).rejects.toBe(denied);

    expect(mocks.requireSelf).toHaveBeenCalledWith("account.changeAvatar");
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.avatarRejection).not.toHaveBeenCalled();
    expect(mocks.setAvatar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("限流拒绝时不校验或保存上传内容", async () => {
    mocks.rateLimit.mockReturnValue({ ok: false, retryAfterMs: 1_000 });

    const result = await updateAvatarAction({}, upload(Uint8Array.of(1)));

    expect(result).toEqual({ error: "操作过于频繁，请稍后再试。" });
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      `settings:avatar:${viewer.uid}`,
      ACTION_LIMITS.updateAvatarAction.max,
      ACTION_LIMITS.updateAvatarAction.windowSeconds * 1_000,
    );
    expect(mocks.avatarRejection).not.toHaveBeenCalled();
    expect(mocks.setAvatar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("校验拒绝时原样返回理由且不保存", async () => {
    mocks.avatarRejection.mockReturnValue("头像格式不支持。");

    const result = await updateAvatarAction({}, upload(Uint8Array.of(1, 2)));

    expect(result).toEqual({ error: "头像格式不支持。" });
    expect(mocks.setAvatar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("保存原始字节并刷新所有头像入口", async () => {
    const bytes = Uint8Array.of(1, 2, 3, 255);

    const result = await updateAvatarAction({}, upload(bytes));

    expect(result).toEqual({ message: "头像已更新。" });
    expect(mocks.requireSelf).toHaveBeenCalledWith("account.changeAvatar");
    expect(mocks.avatarRejection).toHaveBeenCalledWith(bytes);
    expect(mocks.setAvatar).toHaveBeenCalledWith(viewer.uid, bytes);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("保存失败时不刷新页面", async () => {
    mocks.setAvatar.mockResolvedValue(undefined);

    const result = await updateAvatarAction({}, upload(Uint8Array.of(1)));

    expect(result).toEqual({ error: "更新失败，请重试。" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("removeAvatarAction", () => {
  it("没有头像时不消耗限流额度也不写数据库", async () => {
    mocks.requireSelf.mockResolvedValue({ ...viewer, avatarUpdatedAt: null });

    const result = await removeAvatarAction({}, new FormData());

    expect(result).toEqual({ error: "当前没有设置头像。" });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.clearAvatar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("限流拒绝时不移除头像", async () => {
    mocks.rateLimit.mockReturnValue({ ok: false, retryAfterMs: 1_000 });

    const result = await removeAvatarAction({}, new FormData());

    expect(result).toEqual({ error: "操作过于频繁，请稍后再试。" });
    expect(mocks.clearAvatar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("移除成功后刷新所有头像入口", async () => {
    const result = await removeAvatarAction({}, new FormData());

    expect(result).toEqual({ message: "头像已移除。" });
    expect(mocks.requireSelf).toHaveBeenCalledWith("account.changeAvatar");
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      `settings:avatar:${viewer.uid}`,
      ACTION_LIMITS.removeAvatarAction.max,
      ACTION_LIMITS.removeAvatarAction.windowSeconds * 1_000,
    );
    expect(mocks.clearAvatar).toHaveBeenCalledWith(viewer.uid);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("数据库未移除任何头像时不刷新页面", async () => {
    mocks.clearAvatar.mockResolvedValue(false);

    const result = await removeAvatarAction({}, new FormData());

    expect(result).toEqual({ error: "移除失败，请重试。" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
