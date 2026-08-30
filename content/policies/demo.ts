import { policy } from "@/lib/authz/types";

/**
 * 公开演示账号是共用的。
 *
 * demo1 到 demoN 由 scripts/demo-seed.cjs 建立，密码公示在首页，谁都能登。任何
 * 把其中一个从公用池子里拿走的动作——改掉它的凭据，或者封禁它——都要等下一次每夜
 * 重建才恢复得回来，所以这些动作对所有人关闭，包括账号自己。
 *
 * 条件都写在 resource 上而不是 principal 上：发起的人可以是运维组，要保护的是被
 * 指名的那个账号。
 */
const DEMO = "演示账号";

export const policies = [
  policy({
    id: "demo:frozen-credentials",
    effect: "forbid",
    describe:
      "演示账号的昵称、用户名、邮箱与密码都不可改动，找回密码流程对它们同样关闭",
    action: [
      "account.changeNickname",
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
    describe: "演示账号不能被封禁，也不能被解封，它的状态由每夜重建维护",
    action: "account.suspend",
    when: ({ resource }) => resource.groups.includes(DEMO),
    reason: {
      code: "demo-account",
      message:
        "这是公开的演示账号，不能封禁或解封。它的状态由每夜重建维护，scripts/demo-seed.cjs 会把它重置回可用。",
    },
  }),
];
