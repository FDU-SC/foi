import type { ResourceKind, ResourceMap } from "./resources";

/**
 * The action catalog: every question the platform ever asks about permission.
 *
 * This lives in the platform, not in content, because the enforcement points
 * are platform code — `app/` and `lib/` name these ids literally. Content does
 * not invent actions; it writes the policies that answer them.
 */

/** A machine-readable code plus the sentence a user should read. */
export interface DenialReason {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

interface ActionSpec {
  /** The resource this action is taken on. */
  resource: ResourceKind;

  /** One line, shown in the policy matrix and in boot diagnostics. */
  describe: string;

  /** Returned when no policy permits the request. */
  denial: DenialReason;

  /**
   * Rows of this resource are listed out of the database, so a list request
   * goes through `rowScope` instead of evaluating every row.
   */
  queryable?: true;
}

export const ACTIONS = {
  "problem.read": {
    resource: "problem",
    describe: "打开一道题的题面",
    denial: { code: "not-found", message: "题目不存在" },
  },
  "problem.submit": {
    resource: "problem",
    describe: "向一道题提交答案",
    denial: { code: "not-open", message: "这道题现在不接受提交" },
  },
  "problem.invoke": {
    resource: "problem",
    describe: "调用一道题的交互动作",
    denial: { code: "not-open", message: "这道题现在不接受交互" },
  },

  "contest.read": {
    resource: "contest",
    describe: "打开一场比赛的公告页",
    denial: { code: "not-found", message: "比赛不存在" },
  },
  "contest.enter": {
    resource: "contest",
    describe: "以参赛者身份参加一场比赛",
    denial: { code: "not-entered", message: "你不在这场比赛的参赛名单中" },
  },
  "contest.readProblemSet": {
    resource: "contest",
    describe: "开赛前看到题目清单：几道题、叫什么、各值多少分",
    denial: { code: "not-started", message: "比赛尚未开始" },
  },

  "standings.read": {
    resource: "contest",
    describe: "看一场比赛的排行榜",
    denial: { code: "not-found", message: "排行榜不存在" },
  },
  "standings.readUnfrozen": {
    resource: "contest",
    describe: "封榜期间看到真实排名，而不是冻结后的那一份",
    denial: { code: "frozen", message: "封榜期间不展示实时结果" },
  },

  "submission.read": {
    resource: "submission",
    describe: "看一条提交的详情，含提交内容与评测结果",
    denial: { code: "not-found", message: "提交不存在" },
    queryable: true,
  },
  "submission.rejudge": {
    resource: "submission",
    describe: "把一条已终结的提交放回评测队列",
    denial: { code: "forbidden", message: "没有重新评测的权限" },
  },

  "account.read": {
    resource: "account",
    describe: "读一个账号的目录信息，含邮箱与凭据状态",
    denial: { code: "forbidden", message: "没有查看账号的权限" },
    queryable: true,
  },
  "account.viewProfile": {
    resource: "account",
    describe: "打开一个账号的公开主页：头像、昵称、用户组",
    denial: { code: "not-found", message: "页面不存在" },
  },
  "account.changeEmail": {
    resource: "account",
    describe: "更换一个账号绑定的邮箱",
    denial: { code: "forbidden", message: "没有更换邮箱的权限" },
  },
  "account.changeUsername": {
    resource: "account",
    describe: "更改一个账号的用户名",
    denial: { code: "forbidden", message: "没有更改用户名的权限" },
  },
  "account.changePassword": {
    resource: "account",
    describe: "更改一个账号的密码",
    denial: { code: "forbidden", message: "没有更改密码的权限" },
  },
  "account.changeNickname": {
    resource: "account",
    describe: "更改一个账号的昵称",
    denial: { code: "forbidden", message: "没有更改昵称的权限" },
  },
  "account.changeAvatar": {
    resource: "account",
    describe: "更换或移除一个账号的头像",
    denial: { code: "forbidden", message: "没有更改头像的权限" },
  },
  "account.suspend": {
    resource: "account",
    describe: "封禁或解封一个账号",
    denial: { code: "forbidden", message: "没有封禁账号的权限" },
  },
  "account.sendPasswordReset": {
    resource: "account",
    describe: "让一个账号收到找回密码的邮件",
    denial: { code: "forbidden", message: "这个账号不能接收找回密码的邮件" },
  },
  "account.resetPassword": {
    resource: "account",
    describe: "凭找回链接为一个账号设置新密码",
    denial: { code: "forbidden", message: "这个账号不能重置密码" },
  },
  "account.register": {
    resource: "site",
    describe: "注册一个新账号",
    denial: { code: "closed", message: "现在未开放注册" },
  },

  "admin.enter": {
    resource: "site",
    describe: "进入运维台",
    denial: { code: "not-found", message: "页面不存在" },
  },
  "judge.readBoard": {
    resource: "site",
    describe: "查看评测机与评测队列",
    denial: { code: "not-found", message: "页面不存在" },
  },

  "backend.read": {
    resource: "backend",
    describe: "知道一台题目后端存在",
    denial: { code: "not-found", message: "题目后端不存在" },
  },
  "backend.inspect": {
    resource: "backend",
    describe: "查看一台题目后端的地址、评测机与队列细节",
    denial: { code: "forbidden", message: "没有查看后端细节的权限" },
  },
} as const satisfies Record<string, ActionSpec>;

export type ActionId = keyof typeof ACTIONS;

export type ResourceOf<A extends ActionId> =
  ResourceMap[(typeof ACTIONS)[A]["resource"]];

export type QueryableActionId = {
  [A in ActionId]: (typeof ACTIONS)[A] extends { queryable: true } ? A : never;
}[ActionId];

/** Actions with no target, so they can be asked without loading anything. */
export type SiteActionId = {
  [A in ActionId]: (typeof ACTIONS)[A]["resource"] extends "site" ? A : never;
}[ActionId];

export type AccountActionId = {
  [A in ActionId]: (typeof ACTIONS)[A]["resource"] extends "account" ? A : never;
}[ActionId];

export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

export function isActionId(value: string): value is ActionId {
  return value in ACTIONS;
}

export function denialFor(action: ActionId): DenialReason {
  return ACTIONS[action].denial;
}

export function isQueryable(action: ActionId): boolean {
  return "queryable" in ACTIONS[action];
}
