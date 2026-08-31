import { policy } from "@/lib/authz/types";
import { CONSOLE, FULL } from "./groups";

/**
 * Every action in the catalogue is permitted by something here or by a builtin,
 * so a kernel test can always obtain a viewer for the gate it is exercising.
 *
 * Order matters in one place: the full-privilege grants come first, because
 * `groupWith(action)` takes the first group an unconditional permit names.
 */
export const policies = [
  policy({
    id: "fixture:full",
    effect: "permit",
    describe: "全权组：预览、排名、提交、账号、后端，运维台里的一切",
    action: [
      "problem.read",
      "contest.read",
      "contest.readProblemSet",
      "standings.read",
      "standings.readUnfrozen",
      "submission.read",
      "submission.rejudge",
      "account.read",
      "account.suspend",
      "account.sendPasswordReset",
      "admin.enter",
      "judge.readBoard",
      "backend.read",
      "backend.inspect",
    ],
    principal: { group: FULL },
  }),

  policy({
    id: "fixture:console",
    effect: "permit",
    describe: "控制台组：进得了运维台，看得到评测队列，读不到账号目录",
    action: ["admin.enter", "judge.readBoard", "backend.read"],
    principal: { group: CONSOLE },
  }),

  policy({
    id: "fixture:self-service",
    effect: "permit",
    describe: "本人可以改自己的昵称、头像、用户名、邮箱与密码",
    action: [
      "account.changeNickname",
      "account.changeAvatar",
      "account.changeUsername",
      "account.changeEmail",
      "account.changePassword",
    ],
    principal: { self: true },
  }),

  policy({
    id: "fixture:own-submissions",
    effect: "permit",
    describe: "本人可以看自己的提交",
    action: "submission.read",
    principal: { self: true },
  }),

  policy({
    id: "fixture:registration",
    effect: "permit",
    describe: "任何人都可以注册，也可以凭找回链接重设密码",
    action: ["account.register", "account.resetPassword"],
  }),

  policy({
    id: "fixture:public-profiles",
    effect: "permit",
    describe: "任何人都可以打开选手主页",
    action: "account.viewProfile",
  }),
];
