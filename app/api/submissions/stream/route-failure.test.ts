import { expect, it, vi } from "vitest";
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

it("初始读取失败时归还并发槽后继续抛错", async () => {
  vi.mocked(getSessionUser).mockResolvedValue(USER);
  const error = new Error("read failed");
  vi.mocked(submissionFor).mockRejectedValue(error);

  await expect(
    GET(
      new Request(
        "http://localhost:3000/api/submissions/stream?id=submission",
      ),
    ),
  ).rejects.toBe(error);

  expect(streamConcurrency.held(SLOT)).toBe(0);
});
