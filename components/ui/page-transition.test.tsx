import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ViewTransitionProps } from "react";
import { PageTransition } from "./page-transition";

let boundary: ViewTransitionProps = {};
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  ViewTransition: (props: ViewTransitionProps) => {
    boundary = props;
    return props.children;
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/contests/example" }));

class SnapshotEffect {
  constructor(public pseudoElement: string, private frames: Keyframe[] = []) {}
  getKeyframes() { return this.frames; }
}

function replayUpdate(frames: Keyframe[]) {
  const group = { effect: new SnapshotEffect("::view-transition-group(page)", frames), finish: vi.fn() };
  const old = { effect: new SnapshotEffect("::view-transition-old(page)"), finish: vi.fn() };
  const next = { effect: new SnapshotEffect("::view-transition-new(page)"), finish: vi.fn() };
  const nested = { effect: new SnapshotEffect("::view-transition-new(nested)"), finish: vi.fn() };
  vi.stubGlobal("KeyframeEffect", SnapshotEffect);
  vi.stubGlobal("document", { getAnimations: () => [group, old, next, nested] });
  renderToStaticMarkup(<PageTransition><main>内容</main></PageTransition>);
  expect(boundary.onUpdate).toBeTypeOf("function");
  const unused = () => { throw new Error("此回放不直接操作快照元素"); };
  const pseudo = { animate: unused, getComputedStyle: unused, getAnimations: () => [] };
  boundary.onUpdate?.({ name: "page", group: pseudo, imagePair: pseudo, old: pseudo, new: pseudo }, []);
  return { group, old, next, nested };
}

afterEach(() => { vi.unstubAllGlobals(); boundary = {}; });

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

  it("同页筛选只改变内容高度时结束本层淡入淡出，不干预嵌套动画", () => {
    const result = replayUpdate([
      { width: "1280px", height: "870px", transform: "matrix(1, 0, 0, 1, 160, 57)" },
      { width: "1280px", height: "1000px", transform: "matrix(1, 0, 0, 1, 160, 57)" },
    ]);
    expect(result.old.finish).toHaveBeenCalledOnce();
    expect(result.next.finish).toHaveBeenCalledOnce();
    expect(result.group.finish).not.toHaveBeenCalled();
    expect(result.nested.finish).not.toHaveBeenCalled();
  });
});
