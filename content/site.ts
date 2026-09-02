import type { SiteConfig } from "@/lib/site";

export const site: SiteConfig = {
  name: "FOI",
  title: "FOI 竞赛平台",
  description: "内部竞赛平台",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",

  tagline:
    "一个可插拔的竞赛平台。题面、评测机与赛制计分都以代码形式存放在仓库中，可以像写组件一样定制每一道题的页面。",

  // 题库就是这几场比赛：窗口长期开着，因此它们的题目挂在 /problems 而不是
  // /contests 下。顺序即卡片顺序，分组标题取自各自的 domain。
  catalogue: [
    "graphs",
    "dynamic-programming",
    "data-structures",
    "divide-and-conquer",
    "puzzles",
    "kernel",
    "ctf",
  ],

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
      description: "按方向分区的长期题单，随时提交、随时上榜。",
    },
    {
      href: "/contests",
      title: "比赛",
      description: "有窗口的轮次：进行中的、未开始的、已经结束的。",
    },
    {
      href: "/submissions",
      title: "提交记录",
      description: "追踪自己的评测结果与得分明细。",
    },
  ],
};
