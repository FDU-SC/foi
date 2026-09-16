import { afterEach, expect, it, vi } from "vitest";
import { getSessionUser } from "@/auth";
import { submissionsFor } from "@/lib/submissions/access";
import { SubmissionListView } from "./list";

vi.mock("@/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/submissions/access", () => ({ submissionsFor: vi.fn() }));
vi.mock("@/lib/submissions/queue-position", () => ({ locateInQueues: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
afterEach(() => vi.clearAllMocks());

it("我的提交显式限制为当前用户，不随可读权限扩大", async () => {
  vi.mocked(getSessionUser).mockResolvedValue({ uid: 7, username: "reader", nickname: "Reader", avatarUpdatedAt: null, groups: [] });
  vi.mocked(submissionsFor).mockResolvedValue([]);
  await SubmissionListView();
  expect(submissionsFor).toHaveBeenCalledWith(expect.objectContaining({ uid: 7 }), { uid: 7, limit: 50 });
});

it("游客先登录，不查询提交", async () => {
  vi.mocked(getSessionUser).mockResolvedValue(null);
  await expect(SubmissionListView()).rejects.toThrow("/login?next=/submissions");
  expect(submissionsFor).not.toHaveBeenCalled();
});
