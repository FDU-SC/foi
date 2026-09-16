// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemProvider } from "@/components/problem/problem-context";
import type { Permission } from "@/lib/authz/adapters";
import type { SubmissionView } from "./types";
import { useSubmit } from "./use-submit";

let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useSubmit>;
const request = vi.fn<typeof fetch>();

function Probe() {
  const value = useSubmit();
  useLayoutEffect(() => { current = value; });
  return <span>{value.error}</span>;
}

async function render(submit: Permission) {
  await act(async () => root.render(<ProblemProvider value={{
    config: { slug: "example", title: "示例", maxScore: 100, submit: {} },
    contestSlug: "round", permissions: { submit, actions: {} },
  }}><Probe /></ProblemProvider>));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", request);
  request.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("提交 hook 的独立权限", () => {
  it("直接调用也遵守提交拒绝原因，不发起请求", async () => {
    const permission: Permission = { allowed: false, reason: { code: "not-entered", message: "你不在参赛名单中" } };
    await render(permission);
    await act(async () => { expect(await current.submit("answer")).toBeNull(); });
    expect(current.permission).toEqual(permission);
    expect(host.textContent).toBe(permission.reason.message);
    expect(request).not.toHaveBeenCalled();
    expect(current.submitting).toBe(false);
  });

  it("没有交互权限仍可提交，实际请求拒绝仍反馈给用户", async () => {
    await render({ allowed: true });
    request.mockResolvedValueOnce(new Response(JSON.stringify({ error: "比赛已结束" }), { status: 403 }));
    await act(async () => { expect(await current.submit("answer")).toBeNull(); });
    expect(host.textContent).toBe("比赛已结束");
    expect(request).toHaveBeenCalledOnce();

    const view: SubmissionView = {
      id: "sub_test", contestSlug: "round", problemSlug: "example", state: "completed",
      result: null, detail: null, reason: null, runnerStatus: null, queue: null,
      createdAt: new Date().toISOString(), judgedAt: new Date().toISOString(),
    };
    request.mockResolvedValueOnce(new Response(JSON.stringify(view)));
    await act(async () => { expect(await current.submit("answer")).toEqual(view); });
    expect(current.submission).toEqual(view);
    expect(current.error).toBeNull();
    expect(current.submitting).toBe(false);
  });
});
