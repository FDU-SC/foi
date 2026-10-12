import { policy } from "@/lib/authz/types";

/**
 * 运维组在 content/enrollment/ 的 groups 与分流规则中声明。
 * 被 permit 引用的组是特权组，只能按 uid 分配，禁止按邮箱匹配授予，
 * 以免正则匹配范围错误造成提权。
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
    describe: "预览未公开的题目与比赛，查看封榜期间的真实排名",
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
    describe: "允许监考查看管理概况与评测队列，不提供账号列表与邮箱",
    action: ["admin.enter", "judge.readBoard", "backend.read"],
    principal: { group: PROCTOR },
  }),

  policy({
    id: "staff:protected-accounts",
    effect: "forbid",
    describe: "运维组的账号不能在界面上被封禁",
    action: "account.suspend",
    when: ({ resource }) => resource.groups.includes(STAFF),
    reason: {
      code: "protected",
      message: "该账号属于运维组，不能在此封禁。",
    },
  }),
];
