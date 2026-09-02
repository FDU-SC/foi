import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { openExternalProblem } from "@/test/content-shapes";

const session = vi.hoisted(() => ({
  user: null as { uid: number; groups: string[] } | null,
}));

vi.mock("@/auth", () => ({
  getResolvedUser: () => Promise.resolve(session.user),
}));

const { POST } = await import("./route");

const target = openExternalProblem();

let calls = 0;

function post(action: string): Promise<Response> {
  session.user = { uid: ++calls, groups: [] };

  const slug = target.contest.slug;
  const problem = target.problem.slug;

  const request = new Request(
    `http://localhost:3000/api/contests/${slug}/problems/${problem}/action/${action}`,
    { method: "POST" },
  );

  return POST(request, {
    params: Promise.resolve({ slug, problem, action }),
  } as RouteContext<"/api/contests/[slug]/problems/[problem]/action/[action]">);
}

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
