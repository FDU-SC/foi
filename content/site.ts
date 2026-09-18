import type { SiteConfig } from "@/lib/site";

export const site: SiteConfig = {
  name: "FOI Demo",
  title: "FOI 竞赛平台 · 演示",
  description: "开源竞赛平台 FOI 的演示站点，数据每晚重置。",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",

  tagline: "在线练习与竞赛",

  // 这些长期开放的比赛作为题库分区，使用 /problems 路径。
  // 顺序即卡片顺序，分组标题取自各自的 domain。
  catalogue: [
    "puzzles",
    "kernel",
    "comm",
    "framework",
    "inference",
    "cluster",
    "graphs",
    "dynamic-programming",
    "data-structures",
    "divide-and-conquer",
    "ctf",
    "pwn",
    "reverse",
    "crypto",
    "misc",
  ],

  catalogueLeaderboards: [
    { id: "hpc", title: "HPC & AI Infra", sections: ["kernel", "comm", "framework", "inference", "cluster"], includeInTotal: true },
    { id: "algorithms", title: "算法与数据结构", sections: ["graphs", "dynamic-programming", "data-structures", "divide-and-conquer"], includeInTotal: true },
    { id: "ctf", title: "CTF", sections: ["ctf", "pwn", "reverse", "crypto", "misc"], includeInTotal: true },
    { id: "puzzles", title: "玩具箱", sections: ["puzzles"], includeInTotal: false },
  ],

  navigation: [
    { href: "/problems", label: "题库" },
    { href: "/contests", label: "比赛" },
    { href: "/submissions", label: "我的提交" },
    { href: "/leaderboard", label: "总排行榜", location: "catalogue", visibleWhen: "leaderboard.read" },
    { href: "/judges", label: "评测状态", location: "submissions", visibleWhen: "judge.readBoard" },
    { href: "/judges", label: "评测机", location: "admin", visibleWhen: "judge.readBoard" },
    { href: "/admin", label: "管理", location: "account", visibleWhen: "admin.enter" },
  ],

  passwordMinLength: 8,

  footer: {
    links: [{ href: "https://github.com/FDU-SC/foi", label: "源码" }],
  },

  homeEntries: [
    {
      href: "/login",
      title: "演示账号",
      description: "用 demo1 到 demo5 登录，密码 foi-demo。数据每晚重置。",
    },
    {
      href: "/problems",
      title: "题库",
      description: "按方向分类的练习题单。",
    },
    {
      href: "/contests",
      title: "比赛",
      description: "查看赛程与历届比赛。",
    },
    {
      href: "/submissions",
      title: "我的提交",
      description: "查看自己的提交与评测结果。",
    },
  ],
};
