import type { SiteConfig } from "@/lib/site";

export const site: SiteConfig = {
  name: "FOI",
  title: "FOI 竞赛平台",
  description: "内部竞赛平台",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",

  tagline:
    "一个可插拔的竞赛平台。题面、评测机与赛制计分都以代码形式存放在仓库中，可以像写组件一样定制每一道题的页面。",

  navigation: [
    { href: "/problems", label: "题库" },
    { href: "/contests", label: "比赛" },
    { href: "/submissions", label: "提交记录" },
    { href: "/leaderboard", label: "排行榜", visibleWhen: "leaderboard.read" },
    { href: "/judges", label: "评测机", visibleWhen: "judge.readBoard" },
    { href: "/admin", label: "管理", visibleWhen: "admin.enter" },
  ],

  passwordMinLength: 8,

  footer: {
    links: [{ href: "https://github.com/FDU-SC/foi", label: "源码" }],
  },

  homeEntries: [
    {
      href: "/problems",
      title: "题库",
      description: "浏览全部题目，随时提交练习。",
    },
    {
      href: "/contests",
      title: "比赛",
      description: "查看进行中与已结束的比赛及其排行榜。",
    },
    {
      href: "/submissions",
      title: "提交记录",
      description: "追踪自己的评测结果与得分明细。",
    },
  ],
};
