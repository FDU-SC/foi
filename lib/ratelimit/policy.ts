export type RateLimitSubject =

  | "handle"

  | "handle+resource"

  | "source";

export interface AlsoBound {
  max: number;
  windowSeconds: number;
  subject: RateLimitSubject;

  why: string;
}

export type RateLimitRule =

  | {
      kind: "fixed";
      max: number;
      windowSeconds: number;
      subject: RateLimitSubject;
      also?: AlsoBound;
    }

  | {
      kind: "content";
      subject: RateLimitSubject;
      declaredIn: string;
      also?: AlsoBound;
    }

  | { kind: "unlimited"; why: string };

export type OriginGuard =

  | "same-origin"

  | "read-only"

  | "signed"

  | "framework";

export type RouteRule = RateLimitRule & { guard: OriginGuard };

export const ROUTE_LIMITS = {

  "POST /api/submissions": {
    kind: "content",
    subject: "handle+resource",
    declaredIn: "content/problems/*/problem.ts, content/contests/*/contest.ts",
    also: {
      max: 60,
      windowSeconds: 60,
      subject: "handle",
      why:
        "按题计数是比赛自己的决定，管不住一个账号同时对每一道开放的题各花满一份预算——" +
        "单个全局计数器原本挡的就是这种用法。这一条是内核压在下面的地板，" +
        "定在任何真人都够不到的高度：它防的是一个被盗账号占满评测机，不是塑造玩法。",
    },
    guard: "same-origin",
  },
  "GET /api/submissions": {
    kind: "fixed",
    max: 60,
    windowSeconds: 60,
    subject: "handle",
    guard: "read-only",
  },

  "GET /api/submissions/[id]": {
    kind: "fixed",
    max: 240,
    windowSeconds: 60,
    subject: "handle",
    guard: "read-only",
  },

  "GET /api/submissions/stream": {
    kind: "fixed",
    max: 60,
    windowSeconds: 60,
    subject: "handle",
    guard: "read-only",
  },
  "GET /api/judges/status": {
    kind: "fixed",
    max: 60,
    windowSeconds: 60,
    subject: "handle",
    guard: "read-only",
  },

  "POST /api/problems/[slug]/action/[action]": {
    kind: "content",
    subject: "handle+resource",
    declaredIn: "content/problems/*/problem.ts",
    guard: "same-origin",
  },

  "POST /api/runner/jobs/request": {
    kind: "unlimited",
    why: "评测机无账号可计数；由 SOURCE_GATE 在读 body 与验签之前挡住",
    guard: "signed",
  },
  "GET /api/runner/jobs/[id]": {
    kind: "unlimited",
    why: "同上；且必须持有该行当前的 lease 才拿得到内容",
    guard: "signed",
  },
  "PUT /api/runner/jobs/[id]": {
    kind: "unlimited",
    why: "同上；每次上报都要比对 lease，陈旧的持有者写不进任何东西",
    guard: "signed",
  },

  "GET /api/health": {
    kind: "unlimited",
    why: "存活探针无账号可计数；仍会 select 1，由 SOURCE_GATE 兜底",
    guard: "read-only",
  },

  "POST /api/auth/[...nextauth]": {
    kind: "unlimited",
    why:
      "唯一有代价的动作是登录尝试，由下面的 `login` 在 authorize 里按 handle 与来源双重计数；" +
      "其余端点（signout、session 更新）只改 cookie 与解 JWT，不读库。量由 SOURCE_GATE 兜住",
    guard: "framework",
  },
  "GET /api/auth/[...nextauth]": {
    kind: "unlimited",
    why: "session / csrf / providers 只解 JWT 并回读仓库里的授予，不读库；量由 SOURCE_GATE 兜住",
    guard: "read-only",
  },
} as const satisfies Record<string, RouteRule>;

export const ACTION_LIMITS = {

  login: {
    kind: "fixed",
    max: 10,
    windowSeconds: 300,
    subject: "handle",
    also: {
      max: 40,
      windowSeconds: 300,
      subject: "source",
      why:
        "按 handle 计数只看得见对着一个账号猜密码。把同一个弱密码撒向一百个账号的人，" +
        "每个账号只试一次，那个计数器永远不会响",
    },
  },
  logout: {
    kind: "unlimited",
    why: "只清 cookie，不写库不发信；限它反而会把人卡在登录态里",
  },
  sendCodeAction: { kind: "content", subject: "source", declaredIn: "content/enrollment/*.ts" },
  verifyCodeAction: { kind: "content", subject: "source", declaredIn: "content/enrollment/*.ts" },
  registerAction: { kind: "content", subject: "source", declaredIn: "content/enrollment/*.ts" },
  requestPasswordReset: {
    kind: "fixed",
    max: 10,
    windowSeconds: 3600,
    subject: "source",
  },
  resetPasswordAction: {
    kind: "fixed",
    max: 20,
    windowSeconds: 3600,
    subject: "source",
  },

  resendPasswordResetAction: {
    kind: "fixed",
    max: 10,
    windowSeconds: 3600,
    subject: "handle",
  },
  suspendAccountAction: {
    kind: "unlimited",
    why: "写自己库里的一行，且 account.moderate 拒绝带权限的目标；成本不外溢",
  },
  reinstateAccountAction: {
    kind: "unlimited",
    why: "同 suspendAccountAction",
  },

  rejudgeSubmissionAction: {
    kind: "fixed",
    max: 120,
    windowSeconds: 3600,
    subject: "handle",
  },
} as const satisfies Record<string, RateLimitRule>;

export const SOURCE_GATE = { max: 300, windowSeconds: 60 } as const;

export type RouteKey = keyof typeof ROUTE_LIMITS;
