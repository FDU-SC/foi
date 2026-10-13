import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { describeVerdict } from "@/lib/presentation";
import { VerdictBadge } from "./verdict-badge";

vi.mock("@/lib/presentation", () => ({
  describeVerdict: vi.fn(() => ({ label: "内容结果", short: "CONTENT", tone: "neutral" })),
}));

describe("结果显示", () => {
  it.each([false, 0, "", []].map((result) => ({ result })))("不把 $result 当成没有结果", ({ result }) => {
    vi.mocked(describeVerdict).mockClear();
    const submission = { problemSlug: "opaque", state: "completed" as const, result };
    expect(renderToStaticMarkup(<VerdictBadge submission={submission} />)).toContain("CONTENT");
    expect(describeVerdict).toHaveBeenCalledTimes(1);
    // 没有 preset 时也要原样传下去：署名自建 views 的题目靠它区分"没有 preset"与"预设是空"。
    expect(describeVerdict).toHaveBeenCalledWith("opaque", result, undefined);
  });
  it("把题目选的展示 preset 一并交给解释器", () => {
    vi.mocked(describeVerdict).mockClear();
    const submission = {
      problemSlug: "opaque",
      state: "completed" as const,
      result: 1,
      viewsPreset: "fixture-bare",
    };
    renderToStaticMarkup(<VerdictBadge submission={submission} />);
    expect(describeVerdict).toHaveBeenCalledWith("opaque", 1, "fixture-bare");
  });
  it("没有结果时使用提交生命周期状态", () => {
    vi.mocked(describeVerdict).mockClear();
    const html = renderToStaticMarkup(<VerdictBadge submission={{ problemSlug: "opaque", state: "queued", result: null }} />);
    expect(html).toContain("排队中");
    expect(describeVerdict).not.toHaveBeenCalled();
  });
});
