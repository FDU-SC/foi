import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ViewTransitionProps } from "react";
import { PageTransition } from "./page-transition";

let boundary: ViewTransitionProps = {};
const navigation = vi.hoisted(() => ({
  pathname: "/contests/example",
  previousPath: undefined as { current: string } | undefined,
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  // Preserve the mounted boundary's ref across server-rendered callback captures.
  useRef: (initial: string) => navigation.previousPath ??= { current: initial },
  ViewTransition: (props: ViewTransitionProps) => {
    boundary = props;
    return props.children;
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

class SnapshotEffect {
  constructor(public pseudoElement: string, private frames: Keyframe[] = []) {}
  getKeyframes() { return this.frames; }
}

function replayUpdate(frames: Keyframe[], pathname = navigation.pathname) {
  navigation.pathname = pathname;
  const group = { effect: new SnapshotEffect("::view-transition-group(page)", frames), finish: vi.fn() };
  const old = { effect: new SnapshotEffect("::view-transition-old(page)"), finish: vi.fn() };
  const next = { effect: new SnapshotEffect("::view-transition-new(page)"), finish: vi.fn() };
  const nested = { effect: new SnapshotEffect("::view-transition-new(nested)"), finish: vi.fn() };
  const marker = { effect: new SnapshotEffect("::view-transition-group(marker)"), finish: vi.fn() };
  vi.stubGlobal("KeyframeEffect", SnapshotEffect);
  vi.stubGlobal("document", { getAnimations: () => [group, old, next, nested, marker] });
  renderToStaticMarkup(<PageTransition><main>内容</main></PageTransition>);
  expect(boundary.onUpdate).toBeTypeOf("function");
  const unused = () => { throw new Error("此回放不直接操作快照元素"); };
  const pseudo = { animate: unused, getComputedStyle: unused, getAnimations: () => [] };
  boundary.onUpdate?.({ name: "page", group: pseudo, imagePair: pseudo, old: pseudo, new: pseudo }, []);
  return { group, old, next, nested, marker };
}

afterEach(() => {
  vi.unstubAllGlobals();
  boundary = {};
  navigation.pathname = "/contests/example";
  navigation.previousPath = undefined;
});

describe("页面过渡的后续更新", () => {
  it("路径已更新后到达的宽布局仍保留淡入淡出", () => {
    // Geometry recorded from a streamed workspace reveal in the browser.
    const result = replayUpdate([
      { width: "1280px", transform: "matrix(1, 0, 0, 1, 160, 57)" },
      { width: "1600px", transform: "matrix(1, 0, 0, 1, 0, 57)" },
    ]);
    expect(result.old.finish).not.toHaveBeenCalled();
    expect(result.next.finish).not.toHaveBeenCalled();
    expect(result.group.finish).not.toHaveBeenCalled();
  });

  it("同页更新只改变高度时结束本层动画，不干预嵌套动画和导航指示器", () => {
    const result = replayUpdate([
      { width: "1280px", height: "870px", transform: "matrix(1, 0, 0, 1, 160, 57)" },
      { width: "1280px", height: "1000px", transform: "matrix(1, 0, 0, 1, 160, 57)" },
    ]);
    expect(result.old.finish).toHaveBeenCalledOnce();
    expect(result.next.finish).toHaveBeenCalledOnce();
    expect(result.group.finish).toHaveBeenCalledOnce();
    expect(result.marker.finish).not.toHaveBeenCalled();
    expect(result.nested.finish).not.toHaveBeenCalled();
  });

  it("同页位置变化仍保留过渡", () => {
    const result = replayUpdate([
      { width: "1280px", transform: "matrix(1, 0, 0, 1, 160, 57)" },
      { width: "1280px", transform: "matrix(1, 0, 0, 1, 0, 57)" },
    ]);
    for (const animation of Object.values(result)) {
      expect(animation.finish).not.toHaveBeenCalled();
    }
  });

  it("返回主页保留首次过渡，后续分批内容到达时结束本层动画", () => {
    replayUpdate([]);
    const frames = [
      { width: "1280px", height: "870px", transform: "none" },
      { width: "1280px", height: "1000px", transform: "none" },
    ];
    const navigationResult = replayUpdate(frames, "/");
    for (const animation of Object.values(navigationResult)) {
      expect(animation.finish).not.toHaveBeenCalled();
    }
    for (let update = 0; update < 3; update++) {
      const result = replayUpdate(frames);
      expect(result.group.finish).toHaveBeenCalledOnce();
      expect(result.old.finish).toHaveBeenCalledOnce();
      expect(result.next.finish).toHaveBeenCalledOnce();
      expect(result.nested.finish).not.toHaveBeenCalled();
      expect(result.marker.finish).not.toHaveBeenCalled();
    }
    const back = replayUpdate(frames, "/contests/example");
    for (const animation of Object.values(back)) {
      expect(animation.finish).not.toHaveBeenCalled();
    }
  });
});
