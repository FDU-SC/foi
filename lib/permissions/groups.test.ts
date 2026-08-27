import { describe, expect, it, vi } from "vitest";
import {
  groupsFor,
  listRules,
  looseGroupWarnings,
  rulesForUid,
} from "@/lib/enrollment/registry";
import { isUidsRule } from "@/lib/enrollment/types";
import {
  assertFlatImplications,
  capabilitiesOf,
  declaredGroupIds,
  getGroup,
  groupName,
  hasPrivilege,
  isPrivileged,
  listGroups,
  privilegedGroupIds,
} from "./groups";
import { CAPABILITIES, IMPLIES } from "./policy";

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
    expect(groupName("一个不存在的组")).toBe("一个不存在的组");
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

describe("能力蕴含", () => {
  it("IMPLIES 里的键和值都是真实的能力名", () => {
    for (const [capability, implied] of Object.entries(IMPLIES)) {
      expect(CAPABILITIES).toContain(capability);
      for (const id of implied ?? []) expect(CAPABILITIES).toContain(id);
    }
  });

  it("没有能力蕴含自己，那会是个无意义的条目", () => {
    for (const [capability, implied] of Object.entries(IMPLIES)) {
      expect(implied ?? []).not.toContain(capability);
    }
  });

  it("蕴含关系是平的：没有哪一项的蕴含项自己还有蕴含项", () => {
    for (const implied of Object.values(IMPLIES)) {
      for (const id of implied ?? []) {
        expect(IMPLIES[id]).toBeUndefined();
      }
    }
  });

  it("多跳的蕴含项当场抛错，不看 NODE_ENV，也不用有人持有它", () => {
    const saved = IMPLIES["standings.viewFrozen"];
    IMPLIES["standings.viewFrozen"] = ["admin.access"];
    vi.stubEnv("NODE_ENV", "production");

    try {
      expect(() => assertFlatImplications()).toThrow(/一跳/);
    } finally {
      IMPLIES["standings.viewFrozen"] = saved;
      vi.unstubAllEnvs();
    }
  });

  it("持有某项能力就持有它蕴含的一切", () => {
    for (const [capability, implied] of Object.entries(IMPLIES)) {
      const holder = listGroups().find((group) =>
        (group.capabilities as readonly string[]).includes(capability),
      );
      if (!holder) continue;

      const granted = capabilitiesOf([holder.id]);
      for (const id of implied ?? []) expect(granted.has(id)).toBe(true);
    }
  });

  it("hasPrivilege 与「能力集非空」问的是同一件事", () => {
    const ids = listGroups().map((group) => group.id);

    for (const id of ids) {
      expect(hasPrivilege([id]), id).toBe(capabilitiesOf([id]).size > 0);
    }

    expect(hasPrivilege(ids)).toBe(capabilitiesOf(ids).size > 0);
    expect(hasPrivilege([])).toBe(false);
    expect(hasPrivilege(["一个不存在的组"])).toBe(false);
  });

  it("蕴含出来的能力不会让一个纯分组凭空得到权限", () => {

    expect(capabilitiesOf(["未声明的组-甲", "未声明的组-乙"]).size).toBe(0);
  });
});

describe("只有列出 uid 的规则能授予带权限的用户组", () => {
  it("仓库里按邮箱匹配的规则都没有命中带权限的组", () => {

    for (const rule of listRules()) {
      if (isUidsRule(rule) || typeof rule.groups === "function") continue;
      for (const id of rule.groups) {
        expect(isPrivileged(id)).toBe(false);
      }
    }
  });

  it("带权限的组至少有一个人被点名，否则没人能进 /admin", () => {
    const privileged = new Set(privilegedGroupIds());
    if (privileged.size === 0) return;

    const grantedSomewhere = listRules().some(
      (rule) =>
        isUidsRule(rule) && rule.groups.some((id) => privileged.has(id)),
    );
    expect(grantedSomewhere).toBe(true);
  });

  it("点名规则可以给出带权限的组——这是唯一的入口", () => {
    const privileged = new Set(privilegedGroupIds());
    const viaUids = listRules().flatMap((rule) =>
      isUidsRule(rule) ? rule.groups.filter((id) => privileged.has(id)) : [],
    );

    expect(viaUids.length).toBeGreaterThan(0);
  });

  it("被点名的 uid 会匹配到规则", () => {
    for (const rule of listRules()) {
      if (!isUidsRule(rule)) continue;
      for (const uid of rule.uids) {
        expect(rulesForUid(uid)).toContain(rule);
      }
    }
  });

  it("不带邮箱也能算出全部权限——proxy 的前提", () => {
    const privileged = new Set(privilegedGroupIds());

    for (const rule of listRules()) {
      if (!isUidsRule(rule)) continue;
      const conferred = rule.groups.filter((id) => privileged.has(id));
      if (conferred.length === 0) continue;

      for (const uid of rule.uids) {
        const withoutEmail = groupsFor(uid, null);
        for (const id of conferred) expect(withoutEmail).toContain(id);
      }
    }
  });
});

describe("加组时的防呆", () => {
  it("只点名给过一个人、别处无定义的组名会被报出来", () => {

    const declared = new Set(declaredGroupIds());
    const fromPatterns = new Set(
      listRules().flatMap((rule) =>
        isUidsRule(rule) || typeof rule.groups === "function"
          ? []
          : rule.groups,
      ),
    );

    const uses = new Map<string, number>();
    for (const rule of listRules()) {
      if (!isUidsRule(rule)) continue;
      for (const id of rule.groups) {
        uses.set(id, (uses.get(id) ?? 0) + rule.uids.length);
      }
    }

    const loose = [...uses.entries()]
      .filter(([id, n]) => n === 1 && !declared.has(id) && !fromPatterns.has(id))
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
