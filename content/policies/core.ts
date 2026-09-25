import { policy } from "@/lib/authz/types";

/**
 * 账号自助操作与公开访问策略。
 *
 * 这里的每一条都是 permit：平台默认拒绝，凡是没有被任何策略放行的动作都做不了。
 * 需在保留许可的基础上增加限制时，添加 forbid；匹配的 forbid 优先于 permit。
 */
export const policies = [
  policy({
    id: "self-service",
    effect: "permit",
    describe: "每个人都可以改自己的昵称、头像、用户名、邮箱与密码",
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
    id: "public-profiles",
    effect: "permit",
    describe: "允许所有人查看选手主页",
    action: "account.viewProfile",
  }),

  policy({
    id: "own-submissions",
    effect: "permit",
    describe: "允许用户查看自己的提交内容与评测结果",
    action: "submission.read",
    principal: { self: true },
  }),

  policy({
    id: "registration-open",
    effect: "permit",
    describe: "允许注册账号",
    action: "account.register",
  }),

  policy({
    id: "password-recovery",
    effect: "permit",
    describe: "邮箱已验证的账号可以找回密码",
    action: "account.sendPasswordReset",
    when: ({ resource }) => resource.emailVerified,
  }),

  policy({
    id: "password-reset-by-link",
    effect: "permit",
    describe: "允许凭找回链接重置密码",
    action: "account.resetPassword",
  }),
];
