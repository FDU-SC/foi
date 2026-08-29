import { describe, expect, it } from "vitest";
import { denialFor } from "./actions";
import { evaluate } from "./engine";
import { policy, type CompiledPolicy } from "./types";
import { viewerFor, ANONYMOUS } from "./viewer";

const COHORT = "某个分组";
const PRIVILEGED = "某个特权组";

const PLAYER = viewerFor({ uid: 7, groups: [COHORT] });
const STAFF = viewerFor({ uid: 1, groups: [PRIVILEGED] });

/** `submission.read` has an owner, which is what `{ self: true }` reads. */
const OWN = { id: "sub_1", uid: 7, problemSlug: "a", contestSlug: null };
const OTHERS = { id: "sub_2", uid: 8, problemSlug: "a", contestSlug: null };

function ask(
  policies: CompiledPolicy[],
  viewer = PLAYER,
  resource: unknown = OWN,
) {
  return evaluate(policies, "submission.read", resource, viewer);
}

const READ_ANY = policy({
  id: "test:read-any",
  effect: "permit",
  describe: "特权组读任何提交",
  action: "submission.read",
  principal: { group: PRIVILEGED },
});

const READ_OWN = policy({
  id: "test:read-own",
  effect: "permit",
  describe: "谁都读得到自己的提交",
  action: "submission.read",
  principal: { self: true },
});

const LOCKED = policy({
  id: "test:locked",
  effect: "forbid",
  describe: "封存期间谁都读不到",
  action: "submission.read",
  reason: { code: "locked", message: "已封存" },
});

describe("默认拒绝", () => {
  it("没有任何策略时拒绝，理由取自动作目录", () => {
    expect(ask([])).toEqual({
      allow: false,
      via: null,
      reason: denialFor("submission.read"),
    });
  });

  it("有策略但一条都不命中时同样拒绝", () => {
    expect(ask([READ_ANY]).allow).toBe(false);
  });
});

describe("放行", () => {
  it("命中的策略 id 出现在 via 上", () => {
    expect(ask([READ_OWN])).toEqual({ allow: true, via: "test:read-own" });
  });

  it("多条放行取并集，任何一条命中即可", () => {
    expect(ask([READ_ANY, READ_OWN]).allow).toBe(true);
    expect(ask([READ_ANY, READ_OWN], STAFF, OTHERS).allow).toBe(true);
  });
});

describe("禁止压过放行", () => {
  it("无论声明顺序，forbid 都赢", () => {
    for (const set of [
      [LOCKED, READ_OWN],
      [READ_OWN, LOCKED],
    ]) {
      expect(ask(set)).toEqual({
        allow: false,
        via: "test:locked",
        reason: { code: "locked", message: "已封存" },
      });
    }
  });

  it("没写 reason 的 forbid 回落到动作目录的说法", () => {
    const silent = policy({
      id: "test:silent",
      effect: "forbid",
      describe: "不解释",
      action: "submission.read",
    });

    expect(ask([silent, READ_OWN]).allow).toBe(false);
    expect(ask([silent, READ_OWN])).toMatchObject({
      reason: denialFor("submission.read"),
    });
  });
});

describe("principal 匹配", () => {
  function permitWith(principal: CompiledPolicy["principal"]): CompiledPolicy {
    return policy({
      id: "test:principal",
      effect: "permit",
      describe: "试探 principal",
      action: "submission.read",
      principal,
    });
  }

  it("省略 principal 就是任何人，含匿名", () => {
    expect(ask([permitWith(undefined)], ANONYMOUS, OTHERS).allow).toBe(true);
  });

  it("authenticated 挡住匿名", () => {
    const set = [permitWith({ authenticated: true })];
    expect(ask(set, PLAYER, OTHERS).allow).toBe(true);
    expect(ask(set, ANONYMOUS, OTHERS).allow).toBe(false);
  });

  it("group 精确匹配，不做前缀或包含", () => {
    const set = [permitWith({ group: COHORT })];
    expect(ask(set).allow).toBe(true);
    expect(
      ask(set, viewerFor({ uid: 9, groups: [`${COHORT}的子集`] })).allow,
    ).toBe(false);
  });

  it("anyGroup 命中任一即可", () => {
    const set = [permitWith({ anyGroup: ["另一个组", COHORT] })];
    expect(ask(set).allow).toBe(true);
    expect(ask(set, viewerFor({ uid: 9, groups: ["旁听"] })).allow).toBe(false);
  });

  it("self 只对资源的所有者成立", () => {
    const set = [permitWith({ self: true })];
    expect(ask(set, PLAYER, OWN).allow).toBe(true);
    expect(ask(set, PLAYER, OTHERS).allow).toBe(false);
    expect(ask(set, ANONYMOUS, OWN).allow).toBe(false);
  });
});

describe("when", () => {
  it("拿得到资源、视角与时刻", () => {
    const seen: string[] = [];

    const probe = policy({
      id: "test:probe",
      effect: "permit",
      describe: "记录它看到了什么",
      action: "submission.read",
      when: ({ resource, viewer, now }) => {
        seen.push(`${resource.id}:${viewer.uid}:${now.getFullYear()}`);
        return false;
      },
    });

    evaluate([probe], "submission.read", OWN, PLAYER, {
      now: new Date("2026-05-01"),
    });

    expect(seen).toEqual(["sub_1:7:2026"]);
  });

  it("principal 不匹配时不会被求值", () => {
    let called = false;

    const guarded = policy({
      id: "test:guarded",
      effect: "permit",
      describe: "只对特权组生效",
      action: "submission.read",
      principal: { group: PRIVILEGED },
      when: () => {
        called = true;
        return true;
      },
    });

    expect(ask([guarded]).allow).toBe(false);
    expect(called).toBe(false);
  });
});
