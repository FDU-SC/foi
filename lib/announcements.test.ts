import { afterEach, describe, expect, it } from "vitest";
import { site } from "@/lib/site";
import { announcementExamples } from "@/test/fixtures/announcements";
import { announcementFor, publishedAnnouncements } from "./announcements";
const now = new Date("2030-01-01T00:00:00Z");
const originalAnnouncements = site.announcements;
afterEach(() => {
  site.announcements = originalAnnouncements;
});

describe("公告发布", () => {
  it("置顶优先，同组按发布时间倒序，排除未来和无时区的时间", () => {
    const boundary = {
      ...announcementExamples[1],
      slug: "boundary",
      publishedAt: now.toISOString(),
    };
    const local = {
      ...boundary,
      slug: "local",
      publishedAt: "2029-01-01T00:00:00",
    };
    expect(
      publishedAnnouncements(
        [...announcementExamples, boundary, local],
        now,
      ).map((x) => x.slug),
    ).toEqual(["older-pinned", "boundary", "recent"]);
  });
  it("详情与列表使用相同发布条件，未知和未来标识不可读", () => {
    site.announcements = announcementExamples;
    expect(announcementFor("future", now)).toBeUndefined();
    expect(announcementFor("unknown", now)).toBeUndefined();
    expect(announcementFor("recent", now)?.title).toBe("近期公告示例");
  });
  it("空配置正常返回空列表", () =>
    expect(publishedAnnouncements([], now)).toEqual([]));
});
