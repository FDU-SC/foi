import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getSessionUser } from "@/auth";
import { submissionsFor } from "@/lib/submissions/access";
import { SubmissionListView } from "./list";

vi.mock("@/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/submissions/access", () => ({ submissionsFor: vi.fn() }));
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

it("提交列表展示读取结果中的队列排位", async () => {
  vi.mocked(getSessionUser).mockResolvedValue({ uid: 7, username: "reader", nickname: "Reader", avatarUpdatedAt: null, groups: [] });
  vi.mocked(submissionsFor).mockResolvedValue([{
    id: "sub_list_position", uid: 7, nickname: "Reader",
    contestSlug: "list-fixture", problemSlug: "list-fixture", problemTitle: "Fixture",
    state: "queued", result: null, detail: null, reason: null, runnerStatus: null,
    createdAt: "2030-01-01T00:00:00Z", judgedAt: null,
    queue: { backendId: "list-backend", state: "queued", ahead: 4 },
  }]);
  const html = renderToStaticMarkup(await SubmissionListView());
  expect(html).toContain("队列第 5 位");
  expect(html).toContain("list-backend");
});
