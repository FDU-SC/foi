import { describe, expect, it } from "vitest";
import { builtinPolicies } from "./builtin";
import { evaluate } from "./engine";
import { policy } from "./types";
import { ANONYMOUS } from "./viewer";

const RECOVERY = policy({
  id: "test:password-recovery",
  effect: "permit",
  describe: "允许找回密码",
  action: "account.sendPasswordReset",
});

const ACCOUNT = {
  uid: 42,
  status: "active" as const,
  email: "alice@example.test",
  emailVerified: true,
  groups: [],
};

describe("内建账号不变量", () => {
  it("封禁账号不能被其他策略放行找回密码", () => {
    const action = "account.sendPasswordReset";
    const policies = [...builtinPolicies(), RECOVERY].filter((candidate) =>
      candidate.actions.includes(action),
    );

    expect(
      evaluate(
        policies,
        action,
        ACCOUNT,
        ANONYMOUS,
      ),
    ).toEqual({ allow: true, via: RECOVERY.id });

    expect(
      evaluate(
        policies,
        action,
        { ...ACCOUNT, status: "suspended" },
        ANONYMOUS,
      ),
    ).toEqual({
      allow: false,
      via: "builtin:suspended-account",
      reason: { code: "suspended", message: "这个账号已被封禁" },
    });
  });
});
