import { policy } from "@/lib/authz/types";

/**
 * 全局排行榜对本部署的登录用户开放。
 *
 * 导航里的「排行榜」入口与页面本身都用同一个动作把关：未登录看不到入口，
 * 也进不了页面。
 */
export const policies = [
  policy({
    id: "leaderboard-open",
    effect: "permit",
    describe: "登录用户都可以看全局排行榜（解题数、提交数、首杀数）",
    action: "leaderboard.read",
    principal: { authenticated: true },
  }),
];
