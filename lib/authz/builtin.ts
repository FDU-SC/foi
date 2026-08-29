import { embargoOf } from "@/lib/contests/by-problem";
import {
  hasContestStarted,
  isContestOpen,
  matchesParticipants,
} from "@/lib/contests/types";
import { problemsServedBy } from "@/lib/backend/served";
import { problemBySlug } from "@/lib/problems/registry";
import { inAudience } from "./audience";
import { allows } from "./engine";
import { policy, type CompiledPolicy } from "./types";

/**
 * The policies the platform always carries.
 *
 * They come in exactly two kinds, and the split is the rule for what belongs
 * here at all:
 *
 * - `permit` — what a platform-declared resource attribute *means*. `visibleTo`
 *   would be an inert array of strings if nothing read it; these policies are
 *   its definition, so every deployment reads it the same way.
 *
 * - `forbid` — invariants content must not be able to grant around. Because a
 *   forbid beats every permit, no policy in `content/policies/` can hand out
 *   submissions to a retired problem or a seat in a closed contest.
 *
 * Nothing here grants power to a principal. Every "who may do what" decision
 * lives in `content/policies/`, where a deployment can see and change it.
 */
export function builtinPolicies(): CompiledPolicy[] {
  return [
    policy({
      id: "builtin:problem-audience",
      effect: "permit",
      describe:
        "题目的 visibleTo 覆盖到这个人，且它没有被尚未开赛的比赛扣住时，这道题对他开放",
      action: ["problem.read", "problem.submit", "problem.invoke"],
      when: ({ resource, viewer, now }) =>
        inAudience(resource.visibleTo, viewer) &&
        embargoOf(resource.slug, now) === null,
    }),

    policy({
      id: "builtin:contest-audience",
      effect: "permit",
      describe: "比赛的 visibleTo 覆盖到这个人时，他能看到这场比赛与它的排行榜",
      action: ["contest.read", "contest.enter", "standings.read"],
      when: ({ resource, viewer }) => inAudience(resource.visibleTo, viewer),
    }),

    policy({
      id: "builtin:contest-problem-set",
      effect: "permit",
      describe: "比赛开始之后，看得到这场比赛的人也就看得到它的题目清单",
      action: "contest.readProblemSet",
      when: ({ resource, viewer, now }) =>
        inAudience(resource.visibleTo, viewer) &&
        hasContestStarted(resource, now),
    }),

    policy({
      id: "builtin:backend-serves-reachable-problem",
      effect: "permit",
      describe:
        "一台后端至少评测一道这个人打得开的题时，他可以知道这台后端存在",
      action: "backend.read",
      when: ({ resource, viewer, now }) =>
        problemsServedBy(resource.id).some((slug) => {
          const problem = problemBySlug(slug);
          return problem !== undefined && allows("problem.read", problem, viewer, { now });
        }),
    }),

    policy({
      id: "builtin:anonymous-cannot-write",
      effect: "forbid",
      describe: "没有身份就没有归属：提交、交互与参赛都要求先登录",
      action: ["problem.submit", "problem.invoke", "contest.enter"],
      when: ({ viewer }) => !viewer.authenticated,
      reason: { code: "unauthenticated", message: "请先登录" },
    }),

    policy({
      id: "builtin:retired-problem",
      effect: "forbid",
      describe: "下架的题目题面仍然可读，但不再接受任何提交与交互",
      action: ["problem.submit", "problem.invoke"],
      when: ({ resource }) => resource.retired,
      reason: { code: "retired", message: "这道题已下架，不再接受提交" },
    }),

    policy({
      id: "builtin:contest-attribution",
      effect: "forbid",
      describe:
        "指名了一场比赛时，这道题必须在它的题单里，且它必须正处于收题的时间窗内",
      action: ["problem.submit", "problem.invoke"],
      when: ({ resource, contest, now }) =>
        contest !== null &&
        (!contest.problems.some((entry) => entry.slug === resource.slug) ||
          !isContestOpen(contest, now)),
      reason: {
        code: "contest-mismatch",
        message: "这道题不属于这场比赛，或这场比赛现在不收题",
      },
    }),

    policy({
      id: "builtin:contest-window",
      effect: "forbid",
      describe: "比赛只在开始与结束之间收题，赛前赛后谁都不能作为参赛者动作",
      action: "contest.enter",
      when: ({ resource, now }) => !isContestOpen(resource, now),
      reason: {
        code: "contest-closed",
        message: "这场比赛现在不接受提交",
      },
    }),

    policy({
      id: "builtin:not-in-participants",
      effect: "forbid",
      describe:
        "参赛范围由比赛自己的 participants 划定，没有任何策略能把人塞进闭门赛",
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
      describe: "不能封禁自己：把自己关在门外之后没有人能再打开它",
      action: "account.suspend",
      when: ({ resource, viewer }) => resource.uid === viewer.uid,
      reason: { code: "self", message: "不能封禁自己" },
    }),
  ];
}
