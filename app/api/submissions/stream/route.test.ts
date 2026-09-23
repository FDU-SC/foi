import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/auth";
import { streamConcurrency } from "@/lib/ratelimit/concurrency";
import { submissionFor } from "@/lib/submissions/access";

vi.mock("@/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: () => ({ ok: true }),
}));
vi.mock("@/lib/server/guard", () => ({
  guardRequest: () => null,
}));
vi.mock("@/lib/submissions/access", () => ({
  submissionFor: vi.fn(),
}));

const { GET } = await import("./route");

const USER = {
  uid: 7,
  username: "user",
  nickname: "用户",
  avatarUpdatedAt: null,
  groups: [],
};
const SLOT = `stream:${USER.uid}`;

function open(id: string): Promise<Response> {
  return GET(
    new Request(`http://localhost:3000/api/submissions/stream?id=${id}`),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue(USER);
  expect(streamConcurrency.held(SLOT)).toBe(0);
});

describe("提交事件流的并发槽", () => {
  it("读不到提交时拒绝请求并归还并发槽", async () => {
    vi.mocked(submissionFor).mockResolvedValue(undefined);

    const response = await open("missing");

    expect(response.status).toBe(404);
    expect(streamConcurrency.held(SLOT)).toBe(0);
  });

  it("读取提交失败时归还并发槽后继续抛错", async () => {
    const error = new Error("read failed");
    vi.mocked(submissionFor).mockRejectedValue(error);

    await expect(open("failed")).rejects.toBe(error);
    expect(streamConcurrency.held(SLOT)).toBe(0);
  });
});
