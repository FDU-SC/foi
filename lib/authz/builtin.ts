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
 *   submissions outside a contest's collecting window or a seat in a closed
 *   contest.
 *
 * Nothing here grants power to a principal. Every "who may do what" decision
 * lives in `content/policies/`, where a deployment can see and change it.
 */
export function builtinPolicies(): CompiledPolicy[] {
  return [
    policy({
      id: "builtin:contest-problem-audience",
      effect: "permit",
      describe:
        "比赛的 visibleTo 覆盖到这个人，且它正在展示题目时，题单里的每一道题都对他开放",
      action: ["problem.read", "problem.submit", "problem.invoke"],
      when: ({ resource, viewer, now }) =>
        inAudience(resource.contest.visibleTo, viewer) &&
        showsStatements(resource.contest, now),
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
      describe:
        "比赛开始之后，看得到这场比赛的人也就看得到它的题目清单，直到它自己收回",
      action: "contest.readProblemSet",
      when: ({ resource, viewer, now }) =>
        inAudience(resource.visibleTo, viewer) &&
        showsStatements(resource, now),
    }),

    policy({
      id: "builtin:backend-serves-reachable-problem",
      effect: "permit",
      describe:
        "一台后端至少评测一道这个人打得开的题时，他可以知道这台后端存在",
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
      describe: "没有身份就没有归属：提交、交互与参赛都要求先登录",
      action: ["problem.submit", "problem.invoke", "contest.enter"],
      when: ({ viewer }) => !viewer.authenticated,
      reason: { code: "unauthenticated", message: "请先登录" },
    }),

    policy({
      id: "builtin:problem-not-collecting",
      effect: "forbid",
      describe: "一道题只在它所属的那场比赛收题时，才接受提交与交互",
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
        "比赛只在自己声明的收题窗口内接受参赛者动作：赛前不行，赛后除非它自己留了门",
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
