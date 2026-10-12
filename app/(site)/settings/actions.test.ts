import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

const mocks = vi.hoisted(() => ({
  clearAvatar: vi.fn(),
  normalizeAvatar: vi.fn(),
  rateLimit: vi.fn(),
  requireSelf: vi.fn(),
  revalidatePath: vi.fn(),
  setAvatar: vi.fn(),
  updateBio: vi.fn(),
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

vi.mock("@/lib/accounts/avatar-image", () => ({
  normalizeAvatar: mocks.normalizeAvatar,
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
  updateBio: mocks.updateBio,
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

const { removeAvatarAction, updateAvatarAction, updateBioAction } = await import("./actions");

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

const normalized = Uint8Array.of(9, 9, 9);

function upload(bytes: Uint8Array<ArrayBuffer>): FormData {
  const form = new FormData();
  form.set("avatar", new File([bytes], "avatar.webp", { type: "image/webp" }));
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSelf.mockResolvedValue(viewer);
  mocks.rateLimit.mockResolvedValue({ ok: true });
  mocks.normalizeAvatar.mockResolvedValue({ ok: true, bytes: normalized });
  mocks.setAvatar.mockResolvedValue(new Date("2026-09-08T00:00:00Z"));
  mocks.clearAvatar.mockResolvedValue(true);
  mocks.updateBio.mockResolvedValue({ uid: viewer.uid });
});

function bio(value: string): FormData {
  const form = new FormData();
  form.set("bio", value);
  return form;
}

describe("updateBioAction", () => {
  it("权限拒绝时不限流也不写数据库", async () => {
    const denied = new Error("forbidden");
    mocks.requireSelf.mockRejectedValue(denied);

    await expect(updateBioAction({}, bio("hi"))).rejects.toBe(denied);

    expect(mocks.requireSelf).toHaveBeenCalledWith("account.changeBio");
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.updateBio).not.toHaveBeenCalled();
  });

  it("超长时返回理由且不消耗限流额度", async () => {
    const result = await updateBioAction({}, bio("字".repeat(201)));

    expect(result.error).toMatch(/200/);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.updateBio).not.toHaveBeenCalled();
  });

  it("去掉首尾空白后保存", async () => {
    const result = await updateBioAction({}, bio("  写题的人\n  "));

    expect(result).toEqual({ message: "简介已更新。" });
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      `settings:bio:${viewer.uid}`,
      ACTION_LIMITS.updateBioAction,
    );
    expect(mocks.updateBio).toHaveBeenCalledWith(viewer.uid, "写题的人");
  });

  it("留空即清除", async () => {
    const result = await updateBioAction({}, bio("   "));

    expect(result).toEqual({ message: "简介已清空。" });
    expect(mocks.updateBio).toHaveBeenCalledWith(viewer.uid, null);
  });

  it("限流拒绝时不写数据库", async () => {
    mocks.rateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1_000 });

    const result = await updateBioAction({}, bio("hi"));

    expect(result).toEqual({ error: "操作过于频繁，请稍后再试。" });
    expect(mocks.updateBio).not.toHaveBeenCalled();
  });
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
    expect(mocks.normalizeAvatar).not.toHaveBeenCalled();
    expect(mocks.setAvatar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("限流拒绝时不校验或保存上传内容", async () => {
    mocks.rateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1_000 });

    const result = await updateAvatarAction({}, upload(Uint8Array.of(1)));

    expect(result).toEqual({ error: "操作过于频繁，请稍后再试。" });
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      `settings:avatar:${viewer.uid}`,
      ACTION_LIMITS.updateAvatarAction,
    );
    expect(mocks.normalizeAvatar).not.toHaveBeenCalled();
    expect(mocks.setAvatar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("校验拒绝时原样返回理由且不保存", async () => {
    mocks.normalizeAvatar.mockResolvedValue({ ok: false, error: "头像格式不支持。" });

    const result = await updateAvatarAction({}, upload(Uint8Array.of(1, 2)));

    expect(result).toEqual({ error: "头像格式不支持。" });
    expect(mocks.setAvatar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("保存重新编码后的字节并刷新所有头像入口", async () => {
    const bytes = Uint8Array.of(1, 2, 3, 255);

    const result = await updateAvatarAction({}, upload(bytes));

    expect(result).toEqual({ message: "头像已更新。" });
    expect(mocks.requireSelf).toHaveBeenCalledWith("account.changeAvatar");
    expect(mocks.normalizeAvatar).toHaveBeenCalledWith(bytes);
    expect(mocks.setAvatar).toHaveBeenCalledWith(viewer.uid, normalized);
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
    mocks.rateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1_000 });

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
      ACTION_LIMITS.removeAvatarAction,
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
