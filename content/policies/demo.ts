import { policy } from "@/lib/authz/types";

/**
 * scripts/demo-seed.cjs 创建 demo1 到 demoN，密码公示在首页。
 * 所有人（包括账号本人）均不得修改其凭据或封禁账号，以保持公开可用；
 * 账号每晚重建。
 *
 * 条件针对 resource：即使操作者是运维组，也须保护目标演示账号。
 */
const DEMO = "演示账号";

export const policies = [
  policy({
    id: "demo:frozen-credentials",
    effect: "forbid",
    describe:
      "演示账号的昵称、头像、简介、用户名、邮箱与密码都不可改动，找回密码流程对它们同样关闭",
    action: [
      "account.changeNickname",
      "account.changeAvatar",
      "account.changeBio",
      "account.changeUsername",
      "account.changeEmail",
      "account.changePassword",
      "account.sendPasswordReset",
      "account.resetPassword",
    ],
    when: ({ resource }) => resource.groups.includes(DEMO),
    reason: {
      code: "demo-account",
      message: "这是公开的演示账号，资料与密码不可修改。数据每晚重置。",
    },
  }),

  policy({
    id: "demo:no-suspend",
    effect: "forbid",
    describe: "演示账号不能被封禁或解封，状态每晚自动重置",
    action: "account.suspend",
    when: ({ resource }) => resource.groups.includes(DEMO),
    reason: {
      code: "demo-account",
      message:
        "这是公开的演示账号，不能封禁或解封。账号状态每晚自动重置。",
    },
  }),
];
