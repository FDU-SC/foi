import { describe, expect, it } from "vitest";
import {
  groupsFor,
  listRules,
  looseGroupWarnings,
  rulesForHandle,
} from "@/lib/enrollment/registry";
import { isHandlesRule } from "@/lib/enrollment/types";
import {
  capabilitiesOf,
  declaredGroupIds,
  getGroup,
  groupName,
  isPrivileged,
  listGroups,
  privilegedGroupIds,
} from "./groups";
import { CAPABILITIES, IMPLIES } from "./policy";

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

/**
 * The union used to be all `capabilitiesOf` did, which made the note above
 * `standings.viewFrozen` in `./policy` a claim about intent rather than about
 * behaviour: a deployment granting `submission.readAny` alone got a freeze it
 * believed in and a bypass it did not know about. These pin the closure so
 * that the comment and the code cannot drift apart again.
 */
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

  /**
   * `capabilitiesOf` walks one hop. Asserted rather than assumed, because the
   * day somebody writes a two-hop entry is the day the closure would quietly
   * stop closing — the runtime guard in `capabilitiesOf` throws outside
   * production, and this says the same thing where it is cheap to read.
   */
  it("蕴含关系是平的：没有哪一项的蕴含项自己还有蕴含项", () => {
    for (const implied of Object.values(IMPLIES)) {
      for (const id of implied ?? []) {
        expect(IMPLIES[id]).toBeUndefined();
      }
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

  it("蕴含出来的能力不会让一个纯分组凭空得到权限", () => {
    // The closure runs over what the groups granted, so a membership that
    // granted nothing still grants nothing.
    expect(capabilitiesOf(["2026级", "本科生"]).size).toBe(0);
  });
});

describe("只有列出 handles 的规则能授予带权限的用户组", () => {
  it("仓库里按邮箱匹配的规则都没有命中带权限的组", () => {
    // The load-time check would already have thrown; this states the property
    // so that a future rule change fails here with an explanation rather than
    // at import time with a stack trace.
    for (const rule of listRules()) {
      if (isHandlesRule(rule) || typeof rule.groups === "function") continue;
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
        isHandlesRule(rule) && rule.groups.some((id) => privileged.has(id)),
    );
    expect(grantedSomewhere).toBe(true);
  });

  it("点名规则可以给出带权限的组——这是唯一的入口", () => {
    const privileged = new Set(privilegedGroupIds());
    const viaHandles = listRules().flatMap((rule) =>
      isHandlesRule(rule) ? rule.groups.filter((id) => privileged.has(id)) : [],
    );

    expect(viaHandles.length).toBeGreaterThan(0);
  });

  it("被点名的 handle 全部无法注册——这正是它们能带权限的原因", () => {
    for (const rule of listRules()) {
      if (!isHandlesRule(rule)) continue;
      for (const handle of rule.handles) {
        expect(rulesForHandle(handle)).toContain(rule);
        // Case-insensitively, the way registration normalises before it looks.
        expect(rulesForHandle(handle.toUpperCase())).toContain(rule);
      }
    }
  });

  /**
   * Load-bearing beyond the safety argument. `proxy.ts` decides whether to let
   * a request reach `/admin`, and it runs where there is no database — the
   * session callback in `auth.config.ts` therefore calls `groupsFor(handle,
   * null)`, with no address to match patterns against. That works only because
   * every capability comes from a rule keyed on the handle.
   *
   * Were a pattern ever allowed to confer one, this call would quietly stop
   * seeing it and administrators would be redirected away from a console they
   * are entitled to, with nothing in any log to explain it.
   */
  it("不带邮箱也能算出全部权限——proxy 的前提", () => {
    const privileged = new Set(privilegedGroupIds());

    for (const rule of listRules()) {
      if (!isHandlesRule(rule)) continue;
      const conferred = rule.groups.filter((id) => privileged.has(id));
      if (conferred.length === 0) continue;

      for (const handle of rule.handles) {
        const withoutEmail = groupsFor(handle, null);
        for (const id of conferred) expect(withoutEmail).toContain(id);
      }
    }
  });
});

describe("加组时的防呆", () => {
  it("只点名给过一个人、别处无定义的组名会被报出来", () => {
    // The shape a typo takes: `出题員` for `出题人` parses, validates, and
    // silently leaves its holder with nothing. Nothing else can tell those
    // two apart, so the check is "does anything else refer to this name".
    const declared = new Set(declaredGroupIds());
    const fromPatterns = new Set(
      listRules().flatMap((rule) =>
        isHandlesRule(rule) || typeof rule.groups === "function"
          ? []
          : rule.groups,
      ),
    );

    const uses = new Map<string, number>();
    for (const rule of listRules()) {
      if (!isHandlesRule(rule)) continue;
      for (const id of rule.groups) {
        uses.set(id, (uses.get(id) ?? 0) + rule.handles.length);
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
