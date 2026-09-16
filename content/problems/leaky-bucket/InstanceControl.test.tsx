// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemProvider, type ProblemContextValue } from "@/components/problem/problem-context";
import type { Permission } from "@/lib/authz/adapters";
import { SubmitPanel } from "../../_shared/ui/submit-panel";
import { InstanceControl } from "./InstanceControl";

const allowed: Permission = { allowed: true };
const denied: Permission = { allowed: false, reason: { code: "not-open", message: "此操作暂不开放" } };
let host: HTMLDivElement;
let root: Root;
let permissions: ProblemContextValue["permissions"];
const request = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", request);
  request.mockReset();
  permissions = { submit: allowed, actions: { spawn: allowed, poll: allowed, destroy: allowed } };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(<ProblemProvider value={{
      config: { slug: "example", title: "示例", maxScore: 100, submit: {} },
      contestSlug: "round", permissions,
    }}>
      <SubmitPanel><button>答案提交</button></SubmitPanel>
      <InstanceControl />
    </ProblemProvider>);
  });
}

function button(text: string) {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === text);
  if (!found) throw new Error(`缺少按钮：${text}`);
  return found;
}

async function click(text: string) {
  await act(async () => button(text).click());
}

async function tick(ms = 1500) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function respond(body: unknown, status = 200) {
  request.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

const pulling = { status: "pulling", instanceId: "instance" };
const ready = () => ({ status: "ready", instanceId: "instance", endpoint: "https://instance.example.test", expiresAt: Date.now() + 600_000 });

describe("提交面板与靶机动作独立授权", () => {
  it("不能提交仍可启动实例，不能启动仍可提交", async () => {
    permissions.submit = denied;
    await render();
    expect(host.textContent).not.toContain("答案提交");
    expect(button("启动实例").disabled).toBe(false);
    permissions = { submit: allowed, actions: { spawn: denied } };
    await render();
    expect(button("答案提交")).toBeDefined();
    expect(host.textContent).not.toContain("启动实例");
    expect(host.textContent).toContain(denied.reason.message);
  });

  it("匿名动作保留登录入口，未声明动作不提供启动按钮", async () => {
    permissions.actions.spawn = { allowed: false, reason: { code: "unauthenticated", message: "请先登录" } };
    await render();
    expect(host.querySelector('a[href="/login"]')?.textContent).toBe("登录");
    permissions = { submit: allowed, actions: {} };
    await render();
    expect(host.textContent).toContain("这道题未提供此操作");
    expect(host.textContent).not.toContain("启动实例");
  });

  it.each([denied, undefined])("poll 被拒绝或未声明时保留启动状态，不发起轮询，仍可取消：%s", async (permission) => {
    permissions.actions.poll = permission;
    respond(pulling);
    await render();
    await click("启动实例");
    await tick(6000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("实例正在启动");
    expect(button("取消").disabled).toBe(false);
    expect(host.textContent).toContain(permission ? permission.reason.message : "这道题未提供此操作");
  });

  it("destroy 被拒绝不阻止轮询更新实例", async () => {
    permissions.actions.destroy = denied;
    respond(pulling);
    respond(ready());
    await render();
    await click("启动实例");
    expect(button("取消").disabled).toBe(true);
    await tick();
    expect(host.textContent).toContain("https://instance.example.test");
    expect(button("销毁实例").disabled).toBe(true);
    expect(host.textContent).toContain(denied.reason.message);
  });

  it.each([401, 403, 404])("poll 返回 %s 后停止自动重试并保留实例状态", async (status) => {
    respond(pulling);
    respond({ error: "不能继续查询实例" }, status);
    await render();
    await click("启动实例");
    await tick();
    await tick(10_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("不能继续查询实例");
    expect(host.textContent).toContain("实例正在启动");
    expect(button("取消").disabled).toBe(false);
  });

  it("销毁失败保留实例，成功后才清空，且不受 spawn 权限影响", async () => {
    respond(ready());
    await render();
    await click("启动实例");
    permissions = { submit: denied, actions: { spawn: denied, poll: allowed, destroy: allowed } };
    await render();
    respond({ error: "暂时不能销毁" }, 403);
    await click("销毁实例");
    expect(host.textContent).toContain("https://instance.example.test");
    expect(host.textContent).toContain("暂时不能销毁");
    request.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await click("销毁实例");
    expect(host.textContent).not.toContain("https://instance.example.test");
    expect(host.textContent).not.toContain("暂时不能销毁");
    expect(host.textContent).toContain("未启动");
  });

  it("停止轮询后，用户重新启动实例可以重新查询", async () => {
    respond(pulling);
    respond({ error: "暂时无权查询" }, 403);
    await render();
    await click("启动实例");
    await tick();
    respond({ status: "gone" });
    await click("取消");
    respond(pulling);
    await click("启动实例");
    respond(ready());
    await tick();
    expect(request).toHaveBeenCalledTimes(5);
    expect(host.textContent).toContain("https://instance.example.test");
  });

});
