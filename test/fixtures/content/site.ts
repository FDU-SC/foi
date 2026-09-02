import type { SiteConfig } from "@/lib/site";

export const site: SiteConfig = {
  name: "Fixture",
  title: "夹具站点",
  description: "内核测试用的站点配置。",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",

  // Three catalogued rounds across two headings, so kernel tests reach every
  // side of the split: a heading holding one card, a heading holding two, and
  // the contests that stay under `/contests`.
  catalogue: ["fixture-open", "fixture-archived", "fixture-upsolve"],

  navigation: [
    { href: "/problems", label: "题库" },
    { href: "/contests", label: "比赛" },
    { href: "/admin", label: "管理", visibleWhen: "admin.enter" },
  ],

  passwordMinLength: 8,

  homeEntries: [{ href: "/contests", title: "比赛", description: "浏览比赛。" }],
};
