import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";
import { announcementExamples } from "@/test/fixtures/announcements";
import { AnnouncementDetailView } from "./detail";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
const original = site.announcements;
const originalBody = siteViews.AnnouncementBody;
afterEach(() => {
  site.announcements = original;
  siteViews.AnnouncementBody = originalBody;
  vi.useRealTimers();
});
const props = (slug: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve({}),
});
describe("公告正文", () => {
  it("没有正文插槽时完整显示摘要，有插槽时交给内容渲染", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    site.announcements = announcementExamples;
    siteViews.AnnouncementBody = undefined;
    expect(
      renderToStaticMarkup(await AnnouncementDetailView(props("recent"))),
    ).toContain("第二段包含完整公告信息。");
    siteViews.AnnouncementBody = function AnnouncementBody({ slug }) {
      return <p>正文插槽：{slug}</p>;
    };
    expect(
      renderToStaticMarkup(await AnnouncementDetailView(props("recent"))),
    ).toContain("正文插槽：recent");
  });
  it("未来或未知公告不会渲染正文", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    site.announcements = announcementExamples;
    const Body = vi.fn(() => <p>不可见</p>);
    siteViews.AnnouncementBody = Body;
    await expect(AnnouncementDetailView(props("future"))).rejects.toThrow(
      "not-found",
    );
    await expect(AnnouncementDetailView(props("missing"))).rejects.toThrow(
      "not-found",
    );
    expect(Body).not.toHaveBeenCalled();
  });
});
