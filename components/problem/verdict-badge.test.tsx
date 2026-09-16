import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { describeVerdict } from "@/lib/presentation";
import { VerdictBadge } from "./verdict-badge";
import { VerdictReveal } from "./verdict-reveal";

vi.mock("@/lib/presentation", () => ({
  describeVerdict: vi.fn(() => ({ label: "内容结果", short: "CONTENT", tone: "neutral" })),
}));

describe("结果显示", () => {
  it.each([false, 0, "", []].map((result) => ({ result })))("不把 $result 当成没有结果", ({ result }) => {
    vi.mocked(describeVerdict).mockClear();
    const submission = { problemSlug: "opaque", state: "completed" as const, result };
    expect(renderToStaticMarkup(<VerdictBadge submission={submission} />)).toContain("CONTENT");
    expect(renderToStaticMarkup(<VerdictReveal submission={submission} />)).toContain("CONTENT");
    expect(describeVerdict).toHaveBeenCalledTimes(3);
    expect(describeVerdict).toHaveBeenCalledWith("opaque", result);
  });
  it("没有结果时使用提交生命周期状态", () => {
    vi.mocked(describeVerdict).mockClear();
    const html = renderToStaticMarkup(<VerdictBadge submission={{ problemSlug: "opaque", state: "queued", result: null }} />);
    expect(html).toContain("排队中");
    expect(describeVerdict).not.toHaveBeenCalled();
  });
});
