import { describe, expect, it } from "vitest";
import {
  listGrants,
  listRules,
  looseGroupWarnings,
} from "@/lib/enrollment/registry";
import {
  capabilitiesOf,
  declaredGroupIds,
  getGroup,
  groupName,
  isPrivileged,
  listGroups,
  privilegedGroupIds,
} from "./groups";
import { CAPABILITIES } from "./policy";

/**
 * The safety property these cases exist for: a regex must never be able to
 * hand out privilege.
 *
 * It used to be guaranteed structurally — `role` and `tags` were different
 * fields and only one of them carried capabilities, so a rule producing tags
 * simply had nowhere to put a role. Merging them into one concept removes that
 * accident, so the guarantee has to be stated and checked instead.
 */
describe("用户组声明", () => {
  it("声明的能力都在内核的能力表里", () => {
    for (const group of listGroups()) {
      for (const capability of group.capabilities) {
        expect(CAPABILITIES).toContain(capability);
      }
    }
  });

  it("未声明的组存在但不带能力", () => {
    expect(getGroup("一个不存在的组")).toBeUndefined();
    expect(isPrivileged("一个不存在的组")).toBe(false);
    expect(capabilitiesOf(["一个不存在的组"]).size).toBe(0);
  });

  it("groupName 对未声明的组回落到 id 本身", () => {
    expect(groupName("2026级")).toBe("2026级");
  });

  it("capabilitiesOf 取并集", () => {
    const ids = listGroups().map((group) => group.id);
    const union = capabilitiesOf(ids);

    for (const group of listGroups()) {
      for (const capability of group.capabilities) {
        expect(union.has(capability)).toBe(true);
      }
    }
  });

  it("空成员资格没有任何能力", () => {
    expect(capabilitiesOf([]).size).toBe(0);
  });
});

describe("规则不得授予带权限的用户组", () => {
  it("仓库里的静态规则都没有命中带权限的组", () => {
    // The load-time check would already have thrown; this states the property
    // so that a future rule change fails here with an explanation rather than
    // at import time with a stack trace.
    for (const rule of listRules()) {
      if (typeof rule.groups === "function") continue;
      for (const id of rule.groups) {
        expect(isPrivileged(id)).toBe(false);
      }
    }
  });

  it("带权限的组至少有一个人被指名授予，否则没人能进 /admin", () => {
    const privileged = new Set(privilegedGroupIds());
    if (privileged.size === 0) return;

    const grantedSomewhere = listGrants().some((grant) =>
      grant.groups.some((id) => privileged.has(id)),
    );
    expect(grantedSomewhere).toBe(true);
  });

  it("授权可以给出带权限的组——这是唯一的入口", () => {
    const privileged = new Set(privilegedGroupIds());
    const viaGrant = listGrants().flatMap((grant) =>
      grant.groups.filter((id) => privileged.has(id)),
    );

    expect(viaGrant.length).toBeGreaterThan(0);
  });
});

describe("加组时的防呆", () => {
  it("只出现在一条授权里、别处无定义的组名会被报出来", () => {
    // The shape a typo takes: `出题員` for `出题人` parses, validates, and
    // silently leaves its holder with nothing. Nothing else can tell those
    // two apart, so the check is "does anything else refer to this name".
    const declared = new Set(declaredGroupIds());
    const fromRules = new Set(
      listRules().flatMap((rule) =>
        typeof rule.groups === "function" ? [] : rule.groups,
      ),
    );

    const uses = new Map<string, number>();
    for (const grant of listGrants()) {
      for (const id of grant.groups) {
        uses.set(id, (uses.get(id) ?? 0) + 1);
      }
    }

    const loose = [...uses.entries()]
      .filter(([id, n]) => n === 1 && !declared.has(id) && !fromRules.has(id))
      .map(([id]) => id);

    expect(looseGroupWarnings().length).toBe(loose.length);
  });

  it("仓库当前配置没有可疑的孤立组名", () => {
    expect(looseGroupWarnings()).toEqual([]);
  });

  it("declaredGroupIds 与 listGroups 一致", () => {
    expect(declaredGroupIds().sort()).toEqual(
      listGroups().map((g) => g.id).sort(),
    );
  });
});
