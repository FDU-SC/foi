import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { externallyJudged } from "@/lib/problems/registry";

const session = vi.hoisted(() => ({
  user: null as { uid: number; groups: string[] } | null,
}));

vi.mock("@/auth", () => ({
  getResolvedUser: () => Promise.resolve(session.user),
}));

const { POST } = await import("./route");

const target = externallyJudged().find(
  (problem) =>
    !problem.retired && Object.keys(problem.backend.actions).length > 0,
);

let calls = 0;

function post(
  slug: string,
  action: string,
  options: { contestSlug?: string } = {},
): Promise<Response> {
  session.user = { uid: ++calls, groups: ["一个普通分组"] };

  const headers = options.contestSlug
    ? { "x-foi-contest": options.contestSlug }
    : undefined;
  const request = new Request(
    `http://localhost:3000/api/problems/${slug}/action/${action}`,
    { method: "POST", headers },
  );

  return POST(request, {
    params: Promise.resolve({ slug, action }),
  } as RouteContext<"/api/problems/[slug]/action/[action]">);
}

describe.skipIf(!target)("交互端点的配置错误不回传原文", () => {
  const slug = target!.slug;
  const action = Object.keys(target!.backend.actions)[0];
  const backendId = target!.backend.id;

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

    const response = await post(slug, action);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "题目后端配置错误" });
    expect(body).not.toContain("FOI_BACKEND_SECRET");
  });

  it("后端条目根本不存在时也不点名 content/backends.ts", async () => {
    patch(undefined);

    const response = await post(slug, action);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "题目后端配置错误" });
    expect(body).not.toContain("content/backends");
    expect(body).not.toContain(backendId);
  });

  it("原文进日志，运维还是拿得到能动手的那句", async () => {
    patch({ secret: undefined });

    await post(slug, action);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("题目后端配置错误"),
      expect.objectContaining({ message: expect.stringContaining("FOI_") }),
    );
  });
});

describe.skipIf(!target)("交互端点的比赛归属", () => {
  it("客户端指定不存在的比赛时拒绝，而不是降级为赛外操作", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const action = Object.keys(target!.backend.actions)[0];

    try {
      const response = await post(target!.slug, action, {
        contestSlug: "no-such-contest",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "这道题不属于这场比赛，或这场比赛现在不收题",
        code: "contest-mismatch",
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
