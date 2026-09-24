import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewerFor } from "@/lib/authz/viewer";
import { resolveUser } from "@/lib/accounts/resolve";
import type { ResolvedUser } from "@/lib/accounts/types";
import type { SubmissionRow } from "@/lib/db/schema";
import { submissionFor } from "./access";
import { subscribe } from "./events";
import { observeSubmission } from "./observe";
import type { SubmissionView } from "./types";

vi.mock("./access", () => ({ submissionFor: vi.fn() }));
vi.mock("./events", () => ({ subscribe: vi.fn() }));
vi.mock("@/lib/accounts/resolve", () => ({ resolveUser: vi.fn() }));
vi.mock("@/lib/db/read", () => ({ readSnapshot: (read: () => Promise<unknown>) => read() }));

function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const initial: SubmissionView = {
  id: "sub_observe", contestSlug: "round", problemSlug: "problem", state: "queued",
  result: null, detail: null, reason: null, runnerStatus: null,
  createdAt: "2026-09-16T00:00:00Z", judgedAt: null, queue: null,
};
// The observer uses only the authorized view, not the storage record.
function read(view = initial) {
  return { record: {} as SubmissionRow, view };
}

function account(groups: string[] = [], disabled = false): ResolvedUser {
  return {
    uid: 7,
    username: "observer",
    nickname: "Observer",
    avatarUpdatedAt: null,
    email: null,
    emailVerified: false,
    groups,
    status: disabled ? "suspended" : "active",
    disabled,
  };
}

let ready: ReturnType<typeof held<void>>;
let change: () => void;
let failure: (error: unknown) => void;
let unsubscribe = vi.fn<() => void>();
const lifetimes: AbortController[] = [];

function observe(view = initial) {
  const controller = new AbortController();
  lifetimes.push(controller);
  const onView = vi.fn();
  const onHeartbeat = vi.fn();
  const done = observeSubmission({
    id: initial.id, viewer: viewerFor({ uid: 7, groups: [] }), initial: view,
    signal: controller.signal, onView, onHeartbeat,
  });
  return { controller, done, onView, onHeartbeat };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  ready = held<void>();
  unsubscribe = vi.fn();
  vi.mocked(subscribe).mockImplementation((_id, onChange, onError) => {
    change = onChange;
    failure = onError;
    return { ready: ready.promise, unsubscribe };
  });
  vi.mocked(submissionFor).mockResolvedValue(read());
});

afterEach(() => {
  lifetimes.splice(0).forEach((controller) => controller.abort());
  vi.useRealTimers();
});

describe("提交观察", () => {
  it("等待 LISTEN 确认后补读，取得等待期间产生的终态", async () => {
    const watching = observe();
    change();
    expect(submissionFor).not.toHaveBeenCalled();
    vi.mocked(submissionFor).mockResolvedValue(read({ ...initial, state: "completed" }));
    ready.resolve();
    await watching.done;
    expect(watching.onView.mock.calls.map(([view]) => view.state)).toEqual(["queued", "completed"]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("读取中的通知合并为一次后续读取，快照按读取顺序发布", async () => {
    const pending = held<Awaited<ReturnType<typeof submissionFor>>>();
    vi.mocked(submissionFor).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(read({ ...initial, state: "completed" }));
    const watching = observe();
    ready.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let n = 0; n < 10; n++) change();
    expect(submissionFor).toHaveBeenCalledTimes(1);
    pending.resolve(read({ ...initial, state: "judging" }));
    await watching.done;
    expect(submissionFor).toHaveBeenCalledTimes(2);
    expect(watching.onView.mock.calls.map(([view]) => view.state)).toEqual(["queued", "judging", "completed"]);
  });

  it("建立期间取消立即结束，迟到的就绪不再读取或启动心跳", async () => {
    const watching = observe();
    watching.controller.abort();
    await watching.done;
    ready.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(submissionFor).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("取消与终态读取竞争时不再输出", async () => {
    const pending = held<Awaited<ReturnType<typeof submissionFor>>>();
    vi.mocked(submissionFor).mockReturnValue(pending.promise);
    const watching = observe();
    ready.resolve();
    await vi.advanceTimersByTimeAsync(0);
    watching.controller.abort();
    pending.resolve(read({ ...initial, state: "completed" }));
    await watching.done;
    await vi.advanceTimersByTimeAsync(0);
    expect(watching.onView).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each(["连接", "读取", "就绪"])("%s 失败通过观察 Promise 退出并清理", async (stage) => {
    const watching = observe();
    const error = new Error("failed");
    const rejected = expect(watching.done).rejects.toThrow("failed");
    if (stage === "连接") failure(error);
    else if (stage === "就绪") ready.reject(error);
    else {
      ready.resolve();
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(submissionFor).mockRejectedValueOnce(error);
      change();
    }
    await rejected;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("读取拒绝后关闭观察", async () => {
    vi.mocked(submissionFor).mockResolvedValue(undefined);
    const watching = observe();
    ready.resolve();
    await watching.done;
    expect(watching.onView).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: "消失", resolved: null },
    { state: "停用", resolved: account([], true) },
  ])("账号$state时心跳结束观察", async ({ resolved }) => {
    vi.mocked(resolveUser).mockResolvedValue(resolved);
    const watching = observe();
    ready.resolve();
    await vi.advanceTimersByTimeAsync(20_000);
    await watching.done;
    expect(watching.onHeartbeat).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("心跳按最新分组复查读取权限，失权后结束观察", async () => {
    vi.mocked(resolveUser).mockResolvedValue(account(["current-membership"]));
    vi.mocked(submissionFor)
      .mockResolvedValueOnce(read())
      .mockResolvedValueOnce(undefined);
    const watching = observe();
    ready.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(submissionFor).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    await watching.done;

    expect(vi.mocked(submissionFor).mock.calls.map(([, viewer]) => viewer.groups))
      .toEqual([[], ["current-membership"]]);
    expect(watching.onHeartbeat).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("初始快照已完成时不建立订阅", async () => {
    const watching = observe({ ...initial, state: "completed" });
    await watching.done;
    expect(subscribe).not.toHaveBeenCalled();
    expect(watching.onView).toHaveBeenCalledTimes(1);
  });
});
