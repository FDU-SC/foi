// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StandingsLiveRefresh } from "./live-refresh";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const INTERVAL_MS = 15_000;

let container: HTMLDivElement;
let root: Root | undefined;
let visibility: DocumentVisibilityState;

async function render(defaultOn: boolean) {
  await act(async () => {
    root = createRoot(container);
    root.render(<StandingsLiveRefresh defaultOn={defaultOn} />);
  });
  return container.querySelector("button")!;
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = undefined;
  }
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("排行榜自动刷新", () => {
  it("仅在标签页可见时按间隔刷新", async () => {
    const button = await render(true);

    expect(button.getAttribute("aria-pressed")).toBe("true");
    await advance(INTERVAL_MS);
    expect(refresh).toHaveBeenCalledOnce();

    visibility = "hidden";
    await advance(INTERVAL_MS * 2);
    expect(refresh).toHaveBeenCalledOnce();

    visibility = "visible";
    await advance(INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("关闭后清除定时器并停止刷新", async () => {
    const button = await render(false);

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(vi.getTimerCount()).toBe(1);

    await advance(INTERVAL_MS);
    expect(refresh).toHaveBeenCalledOnce();

    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
    await advance(INTERVAL_MS);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("卸载时清除定时器", async () => {
    await render(true);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => root?.unmount());
    root = undefined;

    expect(vi.getTimerCount()).toBe(0);
    await advance(INTERVAL_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});
