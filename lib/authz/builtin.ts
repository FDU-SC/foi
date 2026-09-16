import { contestProblemRefs } from "@/lib/contests/refs";
import {
  acceptsSubmissions,
  matchesParticipants,
  showsStatements,
} from "@/lib/contests/types";
import { problemsServedBy } from "@/lib/backend/served";
import { inAudience } from "./audience";
import { allows } from "./engine";
import { policy, type CompiledPolicy } from "./types";

/**
 * Builtin policies have exactly two roles:
 * - `permit` defines platform resource attributes such as `visibleTo`.
 * - `forbid` enforces invariants content cannot override, including contest
 *   submission windows and entry restrictions.
 *
 * Principal-specific grants belong exclusively in `content/policies/`.
 */
export function builtinPolicies(): CompiledPolicy[] {
  return [
    policy({
      id: "builtin:contest-problem-audience",
      effect: "permit",
      describe:
        "比赛题面开放期间，可见范围内的用户可访问题目；提交和交互另受参赛规则限制",
      action: ["problem.read", "problem.submit", "problem.invoke"],
      when: ({ resource, viewer, now }) =>
        inAudience(resource.contest.visibleTo, viewer) &&
        showsStatements(resource.contest, now),
    }),

    policy({
      id: "builtin:contest-audience",
      effect: "permit",
      describe: "可见范围内的用户可查看比赛和排行榜；参赛另受时间与名单限制",
      action: ["contest.read", "contest.enter", "standings.read"],
      when: ({ resource, viewer }) => inAudience(resource.visibleTo, viewer),
    }),

    policy({
      id: "builtin:contest-problem-set",
      effect: "permit",
      describe:
        "比赛开始后，可见范围内的用户可查看题单，赛后是否开放由比赛决定",
      action: "contest.readProblemSet",
      when: ({ resource, viewer, now }) =>
        inAudience(resource.visibleTo, viewer) &&
        showsStatements(resource, now),
    }),

    policy({
      id: "builtin:backend-serves-reachable-problem",
      effect: "permit",
      describe:
        "用户可查看至少关联一道可访问题目的评测后端",
      action: "backend.read",
      when: ({ resource, viewer, now }) => {
        const served = new Set(problemsServedBy(resource.id));
        return contestProblemRefs().some(
          (ref) =>
            served.has(ref.problem.slug) &&
            allows("problem.read", ref, viewer, { now }),
        );
      },
    }),

    policy({
      id: "builtin:anonymous-cannot-write",
      effect: "forbid",
      describe: "提交、交互与参赛均须登录",
      action: ["problem.submit", "problem.invoke", "contest.enter"],
      when: ({ viewer }) => !viewer.authenticated,
      reason: { code: "unauthenticated", message: "请先登录" },
    }),

    policy({
      id: "builtin:problem-not-collecting",
      effect: "forbid",
      describe: "题目仅在所属比赛接受提交期间开放提交与交互",
      action: ["problem.submit", "problem.invoke"],
      when: ({ resource, now }) => !acceptsSubmissions(resource.contest, now),
      reason: {
        code: "contest-closed",
        message: "这场比赛现在不接受提交",
      },
    }),

    policy({
      id: "builtin:contest-window",
      effect: "forbid",
      describe:
        "比赛开始前不接受参赛操作，赛后仅在允许继续提交时开放",
      action: "contest.enter",
      when: ({ resource, now }) => !acceptsSubmissions(resource, now),
      reason: {
        code: "contest-closed",
        message: "这场比赛现在不接受提交",
      },
    }),

    policy({
      id: "builtin:not-in-participants",
      effect: "forbid",
      describe:
        "参赛范围由比赛的参赛名单或用户组决定，其他策略不能绕过此限制",
      action: "contest.enter",
      when: ({ resource, viewer }) =>
        !matchesParticipants(resource.participants, viewer),
      reason: {
        code: "not-entered",
        message: "你不在这场比赛的参赛名单中",
      },
    }),

    policy({
      id: "builtin:suspended-account",
      effect: "forbid",
      describe: "被封禁的账号不能改动自己的凭据，也不能通过找回流程拿回访问权",
      action: [
        "account.changeEmail",
        "account.changeUsername",
        "account.changePassword",
        "account.changeNickname",
        "account.sendPasswordReset",
        "account.resetPassword",
      ],
      when: ({ resource }) => resource.status !== "active",
      reason: { code: "suspended", message: "这个账号已被封禁" },
    }),

    policy({
      id: "builtin:no-self-suspend",
      effect: "forbid",
      describe: "禁止封禁当前账号",
      action: "account.suspend",
      when: ({ resource, viewer }) => resource.uid === viewer.uid,
      reason: { code: "self", message: "不能封禁自己" },
    }),
  ];
}
