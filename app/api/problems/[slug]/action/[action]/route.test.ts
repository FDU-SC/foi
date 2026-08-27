import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { externallyJudged } from "@/lib/problems/registry";

const session = vi.hoisted(() => ({
  user: null as { handle: string; groups: string[] } | null,
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

function post(slug: string, action: string): Promise<Response> {
  session.user = { handle: `caller-${++calls}`, groups: ["一个普通分组"] };

  const request = new Request(
    `http://localhost:3000/api/problems/${slug}/action/${action}`,
    { method: "POST" },
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
