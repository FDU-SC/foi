import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getSubmission } from "@/app/api/submissions/[id]/route";
import { GET as getSubmissions } from "@/app/api/submissions/route";
import { GET as streamSubmission } from "@/app/api/submissions/stream/route";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { db } from "@/lib/db";
import { accounts, contests, judgingQueue, problems, submissions } from "@/lib/db/schema";
import { createdSubmissionView, submissionFor, submissionsFor } from "./access";
import * as queries from "./queries";
import * as positions from "./queue-position";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const SLUG = "read-snapshot-fixture";
const BACKEND = "read-snapshot-backend";
let uid = 0;
const viewer = () => viewerFor({ uid, groups: [] });
vi.mock("@/auth", () => ({
  getSessionUser: async () => ({ uid, username: SLUG, nickname: SLUG, groups: [] }),
}));

async function insert(id: string, state: "pending" | "completed" | "disrupted" = "pending", queueState?: "waiting" | "claimed") {
  await db.insert(submissions).values({
    id, uid, contestSlug: SLUG, problemSlug: SLUG, backendId: BACKEND, state,
    payload: { secret: "payload" }, clientNonce: `nonce-${id}`,
    releaseSha: "private-release", backendVersion: "private-version",
    error: state === "disrupted" ? "runner failed" : null,
    result: state === "completed" ? { arbitrary: [false, 7, "value"] } : null,
    detail: state === "completed" ? ["opaque", { custom: true }] : null,
    createdAt: new Date("2030-01-01T00:00:00Z"),
  });
  if (queueState) await db.insert(judgingQueue).values({
    submissionId: id, backendId: BACKEND, state: queueState,
    queuedAt: new Date("2030-01-01T00:00:00Z"), runnerStatus: "working",
  });
}

const publicFields = ["id", "problemSlug", "contestSlug", "state", "result", "detail", "reason", "runnerStatus", "createdAt", "judgedAt", "queue"].sort();

describeDb("提交读取快照", () => {
  beforeAll(async () => {
    await db.insert(problems).values({ slug: SLUG, title: SLUG });
    await db.insert(contests).values({ slug: SLUG, title: SLUG });
    const [account] = await db.insert(accounts).values({ username: SLUG, nickname: SLUG }).returning();
    uid = account.uid;
  });
  beforeEach(async () => {
    await db.delete(submissions).where(eq(submissions.uid, uid));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db.delete(submissions).where(eq(submissions.uid, uid));
    await db.delete(accounts).where(eq(accounts.uid, uid));
    await db.delete(problems).where(eq(problems.slug, SLUG));
    await db.delete(contests).where(eq(contests.slug, SLUG));
  });

  it.each([
    ["pending", "waiting", "queued"],
    ["pending", "claimed", "judging"],
    ["pending", undefined, "queued"],
    ["completed", "claimed", "completed"],
    ["disrupted", "claimed", "disrupted"],
  ] as const)("记录 %s、队列 %s 的单条与列表投影一致", async (state, queueState, shown) => {
    const id = "sub_read_states";
    await insert(id, state, queueState);
    const read = await submissionFor(id, viewer());
    expect(read?.record.payload).toEqual({ secret: "payload" });
    expect(read?.view.state).toBe(shown);
    expect(Object.keys(read!.view).sort()).toEqual(publicFields);
    expect(read?.view.queue).toEqual(state === "pending" && queueState
      ? { backendId: BACKEND, state: shown, ahead: 0 } : null);
    expect(read?.view.runnerStatus).toBe(state === "pending" && queueState ? "working" : null);
    if (state === "completed") {
      expect(read?.view.result).toEqual({ arbitrary: [false, 7, "value"] });
      expect(read?.view.detail).toEqual(["opaque", { custom: true }]);
    }
    const [listed] = await submissionsFor(viewer(), { contestSlug: SLUG });
    const { uid: owner, nickname, problemTitle, ...view } = listed;
    expect([owner, nickname, problemTitle]).toEqual([uid, SLUG, SLUG]);
    expect(view).toEqual(read?.view);
  });

  it("拒绝读取不查询队列，创建回执只允许原作者", async () => {
    await insert("sub_read_denied", "pending", "waiting");
    const queue = vi.spyOn(queries, "getQueueInfo");
    const rank = vi.spyOn(positions, "locateInQueues");
    expect(await submissionFor("sub_read_denied", ANONYMOUS)).toBeUndefined();
    expect(await submissionFor("sub_read_absent", viewer())).toBeUndefined();
    expect(await submissionsFor(ANONYMOUS)).toEqual([]);
    await expect(createdSubmissionView("sub_read_denied", uid + 1)).rejects.toThrow();
    expect(queue).not.toHaveBeenCalled();
    expect(rank).not.toHaveBeenCalled();
  });

  it("列表一次批量查询排位，空列表和终态列表不查询排位", async () => {
    const rank = vi.spyOn(positions, "locateInQueues");
    expect(await submissionsFor(viewer())).toEqual([]);
    await insert("sub_read_done", "completed");
    await submissionsFor(viewer());
    expect(rank).not.toHaveBeenCalled();
    await insert("sub_read_first", "pending", "waiting");
    await insert("sub_read_second", "pending", "claimed");
    await submissionsFor(viewer());
    expect(rank).toHaveBeenCalledTimes(1);
    expect(rank.mock.calls[0][0].sort()).toEqual(["sub_read_first", "sub_read_second"]);
  });

  it("排位读取失败不会伪装成没有排位", async () => {
    await insert("sub_read_failure", "pending", "waiting");
    vi.spyOn(positions, "locateInQueues").mockRejectedValue(new Error("rank unavailable"));
    await expect(submissionFor("sub_read_failure", viewer())).rejects.toThrow("rank unavailable");
    await expect(submissionsFor(viewer())).rejects.toThrow("rank unavailable");
  });

  it("读取记录后其他连接领取任务，本次仍返回领取前的完整快照", async () => {
    const id = "sub_read_claim";
    await insert(id, "pending", "waiting");
    const original = queries.getQueueInfo;
    vi.spyOn(queries, "getQueueInfo").mockImplementationOnce(async (...args) => {
      const writer = new Client({ connectionString: process.env.DATABASE_URL });
      await writer.connect();
      try {
        await writer.query("UPDATE judging_queue SET state = 'claimed', runner_status = 'new status' WHERE submission_id = $1", [id]);
      } finally { await writer.end(); }
      return original(...args);
    });
    expect((await submissionFor(id, viewer()))?.view).toMatchObject({
      state: "queued", runnerStatus: "working", queue: { state: "queued" },
    });
    expect((await submissionFor(id, viewer()))?.view).toMatchObject({
      state: "judging", runnerStatus: "new status", queue: { state: "judging" },
    });
  });

  it("列表读取后其他连接完成任务，本次排位仍来自同一快照", async () => {
    const id = "sub_read_complete";
    await insert(id, "pending", "claimed");
    const original = positions.locateInQueues;
    vi.spyOn(positions, "locateInQueues").mockImplementationOnce(async (...args) => {
      const writer = new Client({ connectionString: process.env.DATABASE_URL });
      await writer.connect();
      try {
        await writer.query("BEGIN");
        await writer.query("UPDATE submissions SET state = 'completed' WHERE id = $1", [id]);
        await writer.query("DELETE FROM judging_queue WHERE submission_id = $1", [id]);
        await writer.query("COMMIT");
      } finally { await writer.end(); }
      return original(...args);
    });
    expect(await submissionsFor(viewer())).toMatchObject([{
      state: "judging", runnerStatus: "working", queue: { state: "judging" },
    }]);
    expect((await submissionFor(id, viewer()))?.view).toMatchObject({
      state: "completed", runnerStatus: null, queue: null,
    });
  });

  it.each(["pending", "completed"] as const)("%s 在轮询、事件流、创建回执和列表返回相同公开字段", async (state) => {
    const id = "sub_read_transport";
    await insert(id, state, state === "pending" ? "claimed" : undefined);
    const expected = await createdSubmissionView(id, uid);
    const response = await getSubmission(new Request(`http://localhost/api/submissions/${id}`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    const list = await getSubmissions(new Request("http://localhost/api/submissions"));
    expect(list.status).toBe(200);
    const [item] = await list.json();
    expect(Object.keys(item).sort()).toEqual([...publicFields, "uid", "nickname", "problemTitle"].sort());
    expect(item).toMatchObject(expected);
    const stream = await streamSubmission(new Request(`http://localhost/api/submissions/stream?id=${id}`));
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    try {
      const decoder = new TextDecoder();
      let text = "";
      while (!text.includes("data: ")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("事件流未发送提交");
        text += decoder.decode(chunk.value);
      }
      const data = text.split("\n").find((line) => line.startsWith("data: "))!;
      expect(JSON.parse(data.slice(6))).toEqual(expected);
    } finally { await reader.cancel(); }
  });
});
