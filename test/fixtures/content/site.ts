import type { SiteConfig } from "@/lib/site";

export const site: SiteConfig = {
  name: "Fixture",
  title: "夹具站点",
  description: "内核测试用的站点配置。",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",

  navigation: [
    { href: "/contests", label: "比赛" },
    { href: "/admin", label: "管理", visibleWhen: "admin.enter" },
  ],

  passwordMinLength: 8,

  homeEntries: [{ href: "/contests", title: "比赛", description: "浏览比赛。" }],
};
