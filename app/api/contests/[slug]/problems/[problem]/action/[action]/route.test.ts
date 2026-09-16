import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import {
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
    vi.spyOn(console, "error").mockImplementation(() => {});
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

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("题目后端配置错误"),
      expect.objectContaining({ message: expect.stringContaining("FOI_") }),
    );
  });
});
