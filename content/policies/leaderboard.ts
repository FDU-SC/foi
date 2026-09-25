import { policy } from "@/lib/authz/types";

/**
 * 练习排行榜对本部署的登录用户开放。
 *
 * 题库里的「练习排行榜」入口与页面本身都用同一个动作把关：未登录看不到入口，
 * 也进不了页面。
 */
export const policies = [
  policy({
    id: "leaderboard-open",
    effect: "permit",
    describe: "登录用户可以查看练习排行榜",
    action: "leaderboard.read",
    principal: { authenticated: true },
  }),
];
