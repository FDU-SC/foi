import { describe, expect, it } from "vitest";
import { redactJudgeStatus, type BackendQueueStatus } from "./board";

describe("redactJudgeStatus", () => {
  const status = (): BackendQueueStatus => ({
    id: "queue-a",
    url: "http://localhost:4100",
    runners: 2,
    queued: 1,
    judging: 0,
    items: [
      {
        submissionId: "sub_1",
        problemSlug: "some-problem",
        state: "queued",
        status: "测试点 3/10",
        runnerId: "runner-a",
        enqueuedAt: "2026-08-22T01:46:24.000Z",
      },
    ],
  });

  it("抹掉后端地址与队列条目的题目", () => {
    const redacted = redactJudgeStatus(status());

    expect(redacted.url).toBeNull();
    expect(redacted.items[0]).not.toHaveProperty("problemSlug");
  });

  it("抹掉评测机自述与它的名字，那都是后端作者写的字符串", () => {
    const redacted = redactJudgeStatus(status());

    expect(redacted.items[0]).not.toHaveProperty("status");
    expect(redacted.items[0]).not.toHaveProperty("runnerId");
  });

  it("保留 submissionId，选手要靠它找到自己的排队位次", () => {
    expect(redactJudgeStatus(status()).items[0].submissionId).toBe("sub_1");
  });

  it("不改动原对象，因为读它的不止一个调用方", () => {
    const original = status();

    redactJudgeStatus(original);

    expect(original.url).not.toBeNull();
    expect(original.items[0].problemSlug).toBe("some-problem");
  });
});
