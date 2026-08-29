import { policy } from "@/lib/authz/types";

/**
 * 每个人对自己拥有的东西的权利，以及不需要身份就能做的事。
 *
 * 这里的每一条都是 permit：平台默认拒绝，凡是没有被任何策略放行的动作都做不了。
 * 想要收紧其中一条，不是删掉它，而是补一条 forbid——forbid 压过 permit。
 */
export const policies = [
  policy({
    id: "self-service",
    effect: "permit",
    describe: "每个人都可以改自己的昵称、用户名、邮箱与密码",
    action: [
      "account.changeNickname",
      "account.changeUsername",
      "account.changeEmail",
      "account.changePassword",
    ],
    principal: { self: true },
  }),

  policy({
    id: "own-submissions",
    effect: "permit",
    describe: "每个人都看得到自己交过什么，以及它被判成了什么",
    action: "submission.read",
    principal: { self: true },
  }),

  policy({
    id: "registration-open",
    effect: "permit",
    describe: "开放注册。要关站，删掉这条策略即可；域名白名单在 content/enrollment/",
    action: "account.register",
  }),

  policy({
    id: "password-recovery",
    effect: "permit",
    describe: "已经验证过邮箱的账号可以自助找回密码，请求的人不必是本人",
    action: "account.sendPasswordReset",
    when: ({ resource }) => resource.emailVerified,
  }),

  policy({
    id: "password-reset-by-link",
    effect: "permit",
    describe: "持有找回链接的人可以为这个账号设置新密码；链接本身的验签不在策略层",
    action: "account.resetPassword",
  }),
];
