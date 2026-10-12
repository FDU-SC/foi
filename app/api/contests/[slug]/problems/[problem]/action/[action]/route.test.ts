import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeFor } from "@/lib/problems/actions";
import { callBackendAction } from "@/lib/backend/client";
import { viewerFor } from "@/lib/authz/viewer";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import {
  independentProblemPermissions,
  archivedProblem,
  contestWithGroupEntry,
  openExternalProblem,
} from "@/test/content-shapes";

const session = vi.hoisted(() => ({
  user: null as { uid: number; groups: string[] } | null,
}));

vi.mock("@/auth", () => ({
  getResolvedUser: () => Promise.resolve(session.user),
}));

vi.mock("@/lib/backend/client", () => ({ callBackendAction: vi.fn() }));

const { POST } = await import("./route");

const target = openExternalProblem();

let calls = 0;

interface PostOptions {
  contest?: string;
  problem?: string;
  user?: { uid: number; groups: string[] } | null;
}

function authenticated(groups: string[] = []) {
  return { uid: ++calls, groups };
}

function post(action: string, options: PostOptions = {}): Promise<Response> {
  const {
    contest = target.contest.slug,
    problem = target.problem.slug,
    user = authenticated(),
  } = options;

  session.user = user;

  const request = new Request(
    `http://localhost:3000/api/contests/${contest}/problems/${problem}/action/${action}`,
    { method: "POST" },
  );

  return POST(request, {
    params: Promise.resolve({ slug: contest, problem, action }),
  } as RouteContext<"/api/contests/[slug]/problems/[problem]/action/[action]">);
}

describe("交互端点在调用后端前拒绝无效请求", () => {
  const action = Object.keys(target.problem.backend.actions)[0];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function expectDenied(
    options: PostOptions,
    status: number,
    body: { error: string; code: string },
  ) {
    const backendRequest = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("不应调用题目后端"));

    const response = await post(action, options);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(body);
    expect(backendRequest).not.toHaveBeenCalled();
  }

  it("匿名请求返回 401", async () => {
    await expectDenied({ user: null }, 401, {
      error: "请先登录",
      code: "unauthenticated",
    });
  });

  it("题目不属于比赛时返回 400", async () => {
    await expectDenied({ problem: "不存在的题目" }, 400, {
      error: "这道题不属于这场比赛",
      code: "contest-mismatch",
    });
  });

  it("比赛停止收题后返回 403", async () => {
    const closed = archivedProblem();

    await expectDenied(
      {
        contest: closed.contest.slug,
        problem: closed.problem.slug,
      },
      403,
      {
        error: "这场比赛现在不接受提交",
        code: "contest-closed",
      },
    );
  });

  it("不在参赛名单中时返回 403", async () => {
    const { contest, entry } = contestWithGroupEntry();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(contest.startsAt.getTime() + 60_000));

    await expectDenied(
      {
        contest: contest.slug,
        problem: entry.slug,
        user: authenticated(),
      },
      403,
      {
        error: "你不在这场比赛的参赛名单中",
        code: "not-entered",
      },
    );
  });
});

describe("交互端点的配置错误不回传原文", () => {
  const action = Object.keys(target.problem.backend.actions)[0];
  const backendId = target.problem.backend.id;

  const saved = new Map<string, ProblemBackend | undefined>();

  function patch(changes: Partial<ProblemBackend> | undefined): void {
    if (!saved.has(backendId)) saved.set(backendId, backends[backendId]);
    if (changes === undefined) delete backends[backendId];
    else backends[backendId] = { ...backends[backendId], ...changes };
  }

  beforeEach(() => {

    vi.stubEnv("FOI_BACKEND_SECRET", undefined);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    for (const [id, entry] of saved) {
      if (entry === undefined) delete backends[id];
      else backends[id] = entry;
    }
    saved.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("缺少签名密钥时不把环境变量名写进 500 响应", async () => {
    patch({ secret: undefined });

    const response = await post(action);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "题目后端配置错误" });
    expect(body).not.toContain("FOI_BACKEND_SECRET");
  });

  it("后端条目根本不存在时也不点名 content/backends.ts", async () => {
    patch(undefined);

    const response = await post(action);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "题目后端配置错误" });
    expect(body).not.toContain("content/backends");
    expect(body).not.toContain(backendId);
  });

  it("原文进日志，运维还是拿得到能动手的那句", async () => {
    patch({ secret: undefined });

    await post(action);

    const records = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as { msg?: string; err?: { message?: string } });

    expect(records).toContainEqual(
      expect.objectContaining({
        msg: "题目后端配置错误，无法发起交互动作",
        err: expect.objectContaining({
          message: expect.stringContaining("FOI_"),
        }),
      }),
    );
  });
});

describe("页面预检与交互执行共享 gate", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("逐动作拒绝沿用 gate 原因且不调用后端", async () => {
    const { ref, partial, deniedAction } = independentProblemPermissions();
    const user = authenticated([...partial.groups]);
    const gate = invokeFor(ref.contest.slug, ref.problem.slug, deniedAction, viewerFor(user));
    expect(gate.kind).toBe("denied");
    if (gate.kind !== "denied") throw new Error("需要拒绝的动作");
    vi.mocked(callBackendAction).mockClear();
    const response = await post(deniedAction, { contest: ref.contest.slug, problem: ref.problem.slug, user });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: gate.denial.reason.message, code: gate.denial.reason.code });
    expect(callBackendAction).not.toHaveBeenCalled();
  });

  it("未声明的动作保持原有 404 响应，且不调用后端", async () => {
    vi.mocked(callBackendAction).mockClear();
    const response = await post("no-such-action");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "题目不存在" });
    expect(callBackendAction).not.toHaveBeenCalled();
  });

  it("不能提交的人仍能执行获准的交互动作", async () => {
    const { ref, invokeOnly, allowedAction } = independentProblemPermissions();
    const backend = backends[ref.problem.backend.id];
    const original = backend.secret;
    backend.secret = "test-action-secret";
    vi.mocked(callBackendAction).mockResolvedValue({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    try {
      const response = await post(allowedAction, { contest: ref.contest.slug, problem: ref.problem.slug, user: authenticated([...invokeOnly.groups]) });
      expect(response.status).toBe(200);
      expect(callBackendAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: allowedAction, contestSlug: ref.contest.slug }));
    } finally { backend.secret = original; }
  });
});
