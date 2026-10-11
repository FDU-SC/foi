import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionRow } from "@/lib/db/schema";
import {
  MAX_STREAMS_PER_UID,
  streamConcurrency,
} from "@/lib/ratelimit/concurrency";
import type { SubmissionView } from "@/lib/submissions/types";

const session = vi.hoisted(() => ({
  user: null as {
    uid: number;
    username: string;
    nickname: string;
    groups: string[];
  } | null,
}));

const doubles = vi.hoisted(() => ({
  submissionFor: vi.fn(),
  submissionStream: vi.fn(),
}));

vi.mock("@/auth", () => ({
  getSessionUser: async () => session.user,
}));

vi.mock("@/lib/submissions/access", () => ({
  submissionFor: doubles.submissionFor,
}));

vi.mock("@/lib/submissions/stream", () => ({
  submissionStream: doubles.submissionStream,
}));

const { GET } = await import("./route");

const initial: SubmissionView = {
  id: "sub_stream",
  contestSlug: "round",
  problemSlug: "problem",
  state: "queued",
  result: null,
  detail: null,
  reason: null,
  runnerStatus: null,
  createdAt: "2026-09-16T00:00:00Z",
  judgedAt: null,
  queue: null,
};

const bodies: ReadableStream<Uint8Array>[] = [];
let uid = 50_000;

async function openStream(id = initial.id): Promise<Response> {
  const response = await GET(
    new Request(`http://localhost:3000/api/submissions/stream?id=${id}`),
  );
  if (response.status === 200 && response.body) bodies.push(response.body);
  return response;
}

beforeEach(() => {
  session.user = {
    uid: ++uid,
    username: "stream-user",
    nickname: "Stream User",
    groups: [],
  };
  doubles.submissionFor.mockReset();
  doubles.submissionFor.mockResolvedValue({
    record: {} as SubmissionRow,
    view: initial,
  });
  doubles.submissionStream.mockReset();
  doubles.submissionStream.mockImplementation(
    ({ onClose }: { onClose: () => void }) =>
      new ReadableStream<Uint8Array>({ cancel: onClose }),
  );
});

afterEach(async () => {
  await Promise.all(bodies.splice(0).map((body) => body.cancel()));
});

describe("提交事件流的并发额度", () => {
  it("初始读取被拒绝时释放额度", async () => {
    doubles.submissionFor.mockResolvedValueOnce(undefined);

    const response = await openStream("sub_missing");

    expect(response.status).toBe(404);
    expect(streamConcurrency.held(`stream:${session.user!.uid}`)).toBe(0);
    expect(doubles.submissionStream).not.toHaveBeenCalled();
  });

  it("额度用满后返回重试提示且不超额占用", async () => {
    for (let index = 0; index < MAX_STREAMS_PER_UID; index += 1) {
      await expect(openStream()).resolves.toMatchObject({ status: 200 });
    }

    const overflow = await openStream();

    expect(overflow.status).toBe(429);
    expect(overflow.headers.get("retry-after")).toBe("5");
    expect(streamConcurrency.held(`stream:${session.user!.uid}`)).toBe(
      MAX_STREAMS_PER_UID,
    );
  });
});
