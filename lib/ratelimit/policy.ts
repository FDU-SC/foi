/** At most `max` takes per `windowSeconds`. */
export interface Bound {
  max: number;
  windowSeconds: number;
}

export interface AlsoBound extends Bound {
  why: string;
}

export type RateLimitRule =

  | { max: number; windowSeconds: number; also?: AlsoBound }

  | { content: true; declaredIn: string; also?: AlsoBound }

  | { unlimited: true; why: string };

export type OriginGuard =

  | "same-origin"

  | "read-only"

  | "signed"

  | "framework";

export type RouteRule = RateLimitRule & {
  guard: OriginGuard;

  /**
   * Replaces `SOURCE_GATE` for this route. The default bound assumes one call
   * per page; routes fetched repeatedly by one page need a separate bound.
   * `why` documents the reason.
   */
  flood?: AlsoBound;
};

export const ROUTE_LIMITS = {

  "POST /api/submissions": {
    content: true,
    declaredIn: "content/problems/*/problem.ts, content/contests/*/contest.ts",
    also: {
      max: 60,
      windowSeconds: 60,
      why:
        "比赛的按题限流无法限制同一账号跨题提交的总量。" +
        "内核另设全局上限，防止单个被盗账号占满评测机；比赛仍可设置更严格的按题限制。",
    },
    guard: "same-origin",
  },
  "GET /api/submissions": {
    max: 60,
    windowSeconds: 60,
    guard: "read-only",
  },

  "GET /api/submissions/[id]": {
    max: 240,
    windowSeconds: 60,
    guard: "read-only",
  },

  "GET /api/submissions/stream": {
    max: 60,
    windowSeconds: 60,
    guard: "read-only",
  },
  "GET /api/judges/status": {
    max: 60,
    windowSeconds: 60,
    guard: "read-only",
  },

  "GET /api/avatars/[uid]": {
    unlimited: true,
    why: "公开静态资源，不按账号计数；带版本号的 URL 支持浏览器缓存，请求量由 flood 限制",
    guard: "read-only",
    flood: {
      max: 1200,
      windowSeconds: 60,
      why:
        "SOURCE_GATE 的 300 按每页一次请求设置，排行榜一页可能加载上百张头像；" +
        "使用更高的头像请求上限，避免正常刷新触发 429",
    },
  },

  "POST /api/contests/[slug]/problems/[problem]/action/[action]": {
    content: true,
    declaredIn: "content/problems/*/problem.ts",
    guard: "same-origin",
  },

  "POST /api/runner/jobs/request": {
    unlimited: true,
    why: "评测机无账号可计数；由 SOURCE_GATE 在读 body 与验签之前挡住",
    guard: "signed",
  },
  "GET /api/runner/jobs/[id]": {
    unlimited: true,
    why: "同上；且必须持有该行当前的 lease 才拿得到内容",
    guard: "signed",
  },
  "PUT /api/runner/jobs/[id]": {
    unlimited: true,
    why: "同上；每次上报都要比对 lease，lease 失效后无法写入",
    guard: "signed",
  },

  "GET /api/health": {
    unlimited: true,
    why: "存活探针不按账号计数；会执行 select 1，请求量由 SOURCE_GATE 限制",
    guard: "read-only",
  },

  "POST /api/auth/[...nextauth]": {
    unlimited: true,
    why:
      "唯一有代价的动作是登录尝试，由下面的 `login` 在 authorize 里按 uid 与来源双重计数；" +
      "其余端点（signout、session 更新）只改 cookie 与解 JWT，不读库。请求量由 SOURCE_GATE 限制",
    guard: "framework",
  },
  "GET /api/auth/[...nextauth]": {
    unlimited: true,
    why: "session / csrf / providers 只解 JWT 并回读仓库里的授予，不读库；请求量由 SOURCE_GATE 限制",
    guard: "read-only",
  },
} as const satisfies Record<string, RouteRule>;

export const ACTION_LIMITS = {

  login: {
    max: 10,
    windowSeconds: 300,
    also: {
      max: 40,
      windowSeconds: 300,
      why:
        "按 uid 限流无法阻止同一来源对一百个账号各尝试一次相同弱密码；" +
        "额外按来源限制登录尝试总量",
    },
  },
  logout: {
    unlimited: true,
    why: "仅清除 cookie，不写库或发邮件；不限制退出登录",
  },
  sendVerificationLinkAction: { max: 10, windowSeconds: 3600 },
  registerAction: { max: 10, windowSeconds: 3600 },
  requestPasswordReset: {
    max: 10,
    windowSeconds: 3600,
  },
  resetPasswordAction: {
    max: 20,
    windowSeconds: 3600,
  },

  resendPasswordResetAction: {
    max: 10,
    windowSeconds: 3600,
  },
  updateNicknameAction: {
    max: 20,
    windowSeconds: 3600,
  },
  updateBioAction: {
    max: 20,
    windowSeconds: 3600,
  },
  updateAvatarAction: {
    max: 20,
    windowSeconds: 3600,
  },
  removeAvatarAction: {
    max: 20,
    windowSeconds: 3600,
  },
  updateUsernameAction: {
    max: 10,
    windowSeconds: 3600,
  },
  changePasswordAction: {
    max: 10,
    windowSeconds: 3600,
  },
  requestEmailChangeAction: {
    max: 5,
    windowSeconds: 3600,
  },
  confirmEmailChangeAction: {
    max: 10,
    windowSeconds: 3600,
  },
  suspendAccountAction: {
    unlimited: true,
    why: "仅更新本地数据库的一行，策略拒绝操作受保护账号，不调用外部服务",
  },
  reinstateAccountAction: {
    unlimited: true,
    why: "同 suspendAccountAction",
  },

  rejudgeSubmissionAction: {
    max: 120,
    windowSeconds: 3600,
  },
} as const satisfies Record<string, RateLimitRule>;

export type RouteKey = keyof typeof ROUTE_LIMITS;
