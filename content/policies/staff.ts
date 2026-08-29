import { policy } from "@/lib/authz/types";

/**
 * 运维组的特权。
 *
 * 这个组名同时出现在 content/enrollment/ 的 groups 与分流规则里。平台把
 * 「被某条 permit 点名的用户组」判定为特权组，因此它只能由列出 uid 的规则授予，
 * 按邮箱匹配的规则给不了——正则写错就会把运维台发给一片人。
 */
const STAFF = "管理员";

/** 只看运行状况，不看人：账号目录与邮箱都不在监考的视野里。 */
const PROCTOR = "监考";

export const policies = [
  policy({
    id: "staff:console",
    effect: "permit",
    describe: "进入运维台，查看评测机与评测队列",
    action: ["admin.enter", "judge.readBoard"],
    principal: { group: STAFF },
  }),

  policy({
    id: "staff:preview",
    effect: "permit",
    describe: "校对尚未公开的题目与比赛：题面、题单、封榜期间的真实排名",
    action: [
      "problem.read",
      "contest.read",
      "contest.readProblemSet",
      "standings.read",
      "standings.readUnfrozen",
    ],
    principal: { group: STAFF },
  }),

  policy({
    id: "staff:submissions",
    effect: "permit",
    describe: "查看任何人的提交，并把已终结的提交放回评测队列",
    action: ["submission.read", "submission.rejudge"],
    principal: { group: STAFF },
  }),

  policy({
    id: "staff:accounts",
    effect: "permit",
    describe: "查看账号目录与邮箱，封禁与解封账号，代发找回密码邮件",
    action: ["account.read", "account.suspend", "account.sendPasswordReset"],
    principal: { group: STAFF },
  }),

  policy({
    id: "staff:backends",
    effect: "permit",
    describe: "查看所有题目后端，含它们的地址、评测机与队列细节",
    action: ["backend.read", "backend.inspect"],
    principal: { group: STAFF },
  }),

  policy({
    id: "proctor:console",
    effect: "permit",
    describe: "监考能进运维台核对配置漂移与评测队列，但看不到账号目录与邮箱",
    action: ["admin.enter", "judge.readBoard", "backend.read"],
    principal: { group: PROCTOR },
  }),

  policy({
    id: "staff:protected-accounts",
    effect: "forbid",
    describe: "运维组的账号不能在界面上被封禁，改动他们的权限要改 git 里的分流规则",
    action: "account.suspend",
    when: ({ resource }) => resource.groups.includes(STAFF),
    reason: {
      code: "protected",
      message: "这个账号属于运维组，不能在这里封禁。请改 content/enrollment/ 里的分流规则。",
    },
  }),
];
