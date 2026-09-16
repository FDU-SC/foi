import type { Announcement } from "@/lib/site";

export const announcementExamples: Announcement[] = [
  {
    slug: "older-pinned",
    title: "置顶公告示例",
    summary: "这是一条用于验证公告展示的测试内容。",
    publishedAt: "2029-01-01T08:00:00+08:00",
    pinned: true,
  },
  {
    slug: "recent",
    title: "近期公告示例",
    summary: "第一段。\n\n第二段包含完整公告信息。",
    publishedAt: "2029-12-01T00:00:00Z",
  },
  {
    slug: "future",
    title: "尚未发布",
    summary: "发布时间之前不可见。",
    publishedAt: "2031-01-01T00:00:00Z",
  },
];
