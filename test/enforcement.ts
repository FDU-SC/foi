import type { Capability } from "@/lib/permissions/policy";

export type Grant =

  | "problem.visibleTo"

  | "contest.visibleTo"

  | "contest.participants"

  | "owner"

  | "served-problems"

  | "contest-phase"

  | "capability-only";

export type Denied =

  | "undefined"

  | "null"

  | "empty-array"

  | "empty-object"

  | "filtered-out"

  | "false"

  | "tagged-reason"

  | "redacted"

  | "public-variant"

  | "throws";

export interface Gate {

  what: string;

  capabilities: readonly Capability[];

  noOverride?: string;

  grants: readonly Grant[];

  denied: Denied;
}

export const READ_GATES = {

  "lib/problems/access.ts#problemVisibility": {
    what: "一道题对某人是否可见，以及不可见的原因",
    capabilities: [],
    noOverride:
      "只答受众与禁运两问；`problem.viewAll` 由下面两个取函数在它之上应用，" +
      "经由比赛的那条越权只由 `problemFor` 应用",
    grants: ["problem.visibleTo", "contest-phase"],
    denied: "tagged-reason",
  },

  "lib/problems/access.ts#problemsFor": {
    what: "列出这个人能看到的题目",
    capabilities: ["problem.viewAll"],
    grants: ["problem.visibleTo", "contest-phase"],
    denied: "filtered-out",
  },

  "lib/problems/access.ts#problemFor": {
    what: "取一道题的题面",
    capabilities: ["problem.viewAll", "contest.viewAll"],
    grants: ["problem.visibleTo", "contest-phase", "contest.visibleTo"],
    denied: "undefined",
  },

  "lib/problems/actions.ts#actionFor": {
    what: "这个人能不能对这道题调用某个交互动作",
    capabilities: [],
    noOverride: "同 `submitFor`：`problem.viewAll` 能读题，不能起容器",
    grants: ["problem.visibleTo", "contest-phase"],
    denied: "undefined",
  },

  "lib/contests/access.ts#contestVisibility": {
    what: "一场比赛对某人是否可见，以及不可见的原因",
    capabilities: [],
    noOverride: "只答受众一问；`contest.viewAll` 由下面两个取函数在它之上应用",
    grants: ["contest.visibleTo"],
    denied: "tagged-reason",
  },
  "lib/contests/access.ts#contestsFor": {
    what: "列出这个人能看到的比赛",
    capabilities: ["contest.viewAll"],
    grants: ["contest.visibleTo"],
    denied: "filtered-out",
  },

  "lib/contests/access.ts#contestFor": {
    what: "取一场比赛的公告页数据",
    capabilities: ["contest.viewAll"],
    grants: ["contest.visibleTo"],
    denied: "undefined",
  },

  "lib/contests/access.ts#canEnterContest": {
    what: "这个人有没有参赛资格",
    capabilities: [],
    noOverride:
      "没有任何能力能把人塞进闭门赛；`contest.viewAll` 尤其不能，否则「能读」就成了「能参赛」",
    grants: ["contest.participants"],
    denied: "false",
  },

  "lib/contests/access.ts#isContestProblemSetVisibleTo": {
    what: "开赛前扣住题目集：几道题、叫什么、各值多少分",
    capabilities: ["problem.viewAll"],
    grants: ["contest-phase"],
    denied: "false",
  },

  "lib/contests/access.ts#contestEntryFor": {
    what: "客户端指名的这场比赛，能不能作为这次提交／交互的归属",
    capabilities: [],
    noOverride:
      "没有任何能力能把人塞进闭门赛；`contest.viewAll` 在第一问就被 `gate.visible` 挡下，" +
      "「能读」与「能参赛」正是在那一步分开的",
    grants: ["contest.visibleTo", "contest-phase", "contest.participants"],
    denied: "tagged-reason",
  },

  "lib/submissions/access.ts#submissionFor": {
    what: "取一条提交的详情",
    capabilities: ["submission.readAny"],
    grants: ["owner"],
    denied: "undefined",
  },

  "lib/submissions/access.ts#submissionsFor": {
    what: "列出这个人能看到的提交",
    capabilities: ["submission.readAny"],
    grants: ["owner"],
    denied: "empty-array",
  },

  "lib/submissions/gate.ts#submitFor": {
    what: "这个人能不能对这道题提交，能的话算不算这场比赛的",
    capabilities: [],
    noOverride:
      "校对未开赛题目的 `problem.viewAll` 持有者读得到题面，但不能给它的评测机排队",
    grants: ["problem.visibleTo", "contest-phase", "contest.participants"],
    denied: "tagged-reason",
  },

  "lib/backend/access.ts#canSeeBackend": {
    what: "这个人该不该知道这台后端存在",
    capabilities: ["backend.inspect"],
    grants: ["served-problems"],
    denied: "false",
  },
  "lib/backend/access.ts#backendsFor": {
    what: "列出这个人能看到的题目后端",
    capabilities: ["backend.inspect"],
    grants: ["served-problems"],
    denied: "filtered-out",
  },

  "lib/backend/board.ts#judgeQueuesFor": {
    what: "取评测队列，且只取这个人该看到的那部分",
    capabilities: ["backend.inspect"],
    grants: ["served-problems"],
    denied: "redacted",
  },

  "lib/standings/compute.ts#standingsFor": {
    what: "取排行榜，封榜期间是真实的还是冻结的",
    capabilities: ["standings.viewFrozen"],
    grants: ["capability-only"],
    denied: "public-variant",
  },

  "lib/accounts/access.ts#accountDirectoryFor": {
    what: "读账号目录，含邮箱与凭据状态",
    capabilities: ["account.read"],
    grants: ["capability-only"],
    denied: "empty-object",
  },
  "lib/accounts/access.ts#accountsFor": {
    what: "读账号行，给只需要计数的页面",
    capabilities: ["account.read"],
    grants: ["capability-only"],
    denied: "empty-array",
  },

  "lib/admin/access.ts#adminOverviewFor": {
    what: "读运维台首页的概览与漂移报告",
    capabilities: ["admin.access"],
    grants: ["capability-only"],
    denied: "null",
  },

  "lib/admin/access.ts#adminAccountsFor": {
    what: "读运维台的账号页",
    capabilities: ["admin.access", "account.read"],
    grants: ["capability-only"],
    denied: "null",
  },

  "lib/admin/access.ts#adminContestsFor": {
    what: "读运维台的比赛表，含对任何人都不可见的暂存轮次",
    capabilities: ["admin.access"],
    grants: ["capability-only"],
    denied: "null",
  },

  "lib/admin/access.ts#enrollmentViewFor": {
    what: "读分流规则，以及每条规则命中多少人",
    capabilities: ["admin.access", "account.read"],
    grants: ["capability-only"],
    denied: "null",
  },
} as const satisfies Record<string, Gate>;

export const WRITE_GATES = {

  resendPasswordResetAction: {
    what: "代某个账号发一封找回密码邮件",
    capabilities: ["credential.manage"],
    grants: ["capability-only"],
    denied: "throws",
  },

  suspendAccountAction: {
    what: "封禁一个账号",
    capabilities: ["account.moderate"],
    grants: ["capability-only"],
    denied: "throws",
  },
  reinstateAccountAction: {
    what: "解封一个账号",
    capabilities: ["account.moderate"],
    grants: ["capability-only"],
    denied: "throws",
  },

  rejudgeSubmissionAction: {
    what: "把一条已终结的提交放回评测队列",
    capabilities: ["submission.rejudge"],
    grants: ["capability-only"],
    denied: "throws",
  },
} as const satisfies Record<string, Gate>;

export type ReadGateKey = keyof typeof READ_GATES;
export type WriteGateKey = keyof typeof WRITE_GATES;

export type PageCheck =
  | {

      kind: "chrome";
      what: string;
      capabilities: readonly Capability[];

      enforcedBy: readonly (ReadGateKey | WriteGateKey)[];
    }
  | {

      kind: "optimistic";
      what: string;
      capabilities: readonly Capability[];
      why: string;
      enforcedBy: readonly (ReadGateKey | WriteGateKey)[];
    }
  | {

      kind: "boundary";
      what: string;
      capabilities: readonly Capability[];
      why: string;
    };

export const PAGE_CHECKS = {
  "app/(site)/admin/accounts/page.tsx": {
    kind: "chrome",
    what: "决定每一行要不要画「发送重置邮件」和「封禁」按钮",
    capabilities: ["credential.manage", "account.moderate"],
    enforcedBy: [
      "resendPasswordResetAction",
      "suspendAccountAction",
      "reinstateAccountAction",
    ],
  },

  "app/(site)/contests/[slug]/page.tsx": {
    kind: "chrome",
    what: "开赛前的预览者，题目上方画不画「尚未对选手公开」的徽标",
    capabilities: ["problem.viewAll"],
    enforcedBy: ["lib/contests/access.ts#isContestProblemSetVisibleTo"],
  },

  "app/(site)/submissions/[id]/page.tsx": {
    kind: "chrome",
    what: "详情页上画不画「重新评测」按钮",
    capabilities: ["submission.rejudge"],
    enforcedBy: ["rejudgeSubmissionAction"],
  },
} as const satisfies Record<string, PageCheck>;
