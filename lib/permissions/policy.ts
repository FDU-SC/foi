export const CAPABILITIES = [

  "admin.access",

  "problem.viewAll",

  "contest.viewAll",

  "standings.viewFrozen",

  "submission.readAny",

  "submission.rejudge",

  "backend.inspect",

  "account.read",

  "credential.manage",

  "account.moderate",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const IMPLIES: Partial<Record<Capability, readonly Capability[]>> = {
  "submission.readAny": ["standings.viewFrozen"],
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  "admin.access": "进入运维台",
  "problem.viewAll": "查看全部题目",
  "contest.viewAll": "查看全部比赛",
  "standings.viewFrozen": "封榜期间查看真实排名",
  "submission.readAny": "查看他人提交",
  "submission.rejudge": "重判提交",
  "backend.inspect": "查看题目后端细节",
  "account.read": "查看账号目录与邮箱",
  "credential.manage": "代发找回密码邮件",
  "account.moderate": "封禁与解封账号",
};
