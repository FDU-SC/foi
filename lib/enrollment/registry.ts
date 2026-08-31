import type { z } from "zod";
import { declaredGroupIds } from "@/lib/authz/groups";
import { isPrivilegedGroup, privilegedGroups } from "@/lib/authz/introspect";
import { enrollmentSources } from "./modules";
import {
  enrollmentPolicySchema,
  enrollmentRuleSchema,
  isUidsRule,
  type EnrollmentPolicy,
  type EnrollmentRule,
} from "./types";

interface RuleOrigin {
  path: string;

  /** 1-based, so it reads the same way as the boot message. */
  position: number;
}

interface Registry {
  policy: EnrollmentPolicy;
  rules: EnrollmentRule[];

  origins: Map<EnrollmentRule, RuleOrigin>;

  uidIndex: Map<number, EnrollmentRule[]>;

  declared: boolean;
}

function fail(path: string, what: string, error: z.ZodError): never {
  const issues = error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`${path} 的${what}不合法:\n${issues}`);
}

function buildRegistry(): Registry {
  const rules: EnrollmentRule[] = [];
  const origins = new Map<EnrollmentRule, RuleOrigin>();
  const uidIndex = new Map<number, EnrollmentRule[]>();

  let policy: EnrollmentPolicy | undefined;
  let policySource: string | undefined;

  const sources = enrollmentSources();

  for (const mod of sources) {
    const path = mod.path;

    if (mod.policy !== undefined) {
      if (policySource) {
        throw new Error(
          `enrollment policy 只能声明一次: ${policySource} 与 ${path} 都导出了 policy`,
        );
      }

      const parsed = enrollmentPolicySchema.safeParse(mod.policy);
      if (!parsed.success) fail(path, "注册策略", parsed.error);
      policy = parsed.data;
      policySource = path;
    }

    if (mod.rules !== undefined) {
      if (!Array.isArray(mod.rules)) {
        throw new Error(`${path} 导出的 rules 必须是数组`);
      }
      mod.rules.forEach((raw, index) => {
        const parsed = enrollmentRuleSchema.safeParse(raw);
        if (!parsed.success) fail(path, `第 ${index + 1} 条分流规则`, parsed.error);
        const rule = parsed.data;

        if (isUidsRule(rule)) {
          for (const uid of rule.uids) {
            uidIndex.set(uid, [...(uidIndex.get(uid) ?? []), rule]);
          }
        }

        origins.set(rule, { path, position: index + 1 });
        rules.push(rule);
      });
    }
  }

  return {
    policy: policy ?? enrollmentPolicySchema.parse({}),
    rules,
    origins,
    uidIndex,
    declared: sources.length > 0,
  };
}

const registry = buildRegistry();

export const enrollmentPolicy = registry.policy;

export const enrollmentDeclared: boolean = registry.declared;

export function listRules(): EnrollmentRule[] {
  return registry.rules;
}

export function rulesForUid(uid: number): EnrollmentRule[] {
  return registry.uidIndex.get(uid) ?? [];
}

export function enumeratedUids(): number[] {
  return [...registry.uidIndex.keys()].sort((a, b) => a - b);
}

export function groupsFor(uid: number, email: string | null): string[] {
  const groups = new Set<string>();

  const named = new Set(rulesForUid(uid));

  for (const rule of registry.rules) {
    let produced: readonly string[];

    if (isUidsRule(rule)) {
      if (!named.has(rule)) continue;
      produced = rule.groups;
    } else {
      if (!email) continue;
      const match = email.match(rule.email);
      if (!match) continue;
      produced =
        typeof rule.groups === "function" ? rule.groups(match) : rule.groups;
    }

    const mayGrantPrivilege = isUidsRule(rule);
    for (const id of produced) {
      if (!mayGrantPrivilege && isPrivilegedGroup(id)) {
        console.warn(
          `[foi] 分流规则「${rule.label}」算出了带权限的用户组 "${id}"，已忽略。带权限的组只能由列出 uid 的规则授予。`,
        );
        continue;
      }
      groups.add(id);
    }
  }

  return [...groups];
}

/**
 * An email pattern matches an unbounded set of addresses, so a typo in one
 * would hand a privileged group to everybody who happens to match. Only rules
 * that name uids may grant a group that some policy gives power to.
 *
 * Checked at boot rather than while building the registry, because deciding
 * what "privileged" means requires the policy set, which is built on top of it.
 */
export function enrollmentPrivilegeViolations(): string[] {
  return registry.rules.flatMap((rule) => {
    if (isUidsRule(rule) || typeof rule.groups === "function") return [];

    const privileged = rule.groups.filter(isPrivilegedGroup);
    if (privileged.length === 0) return [];

    const origin = registry.origins.get(rule);
    return [
      `${origin?.path ?? "content/enrollment/"} 第 ${origin?.position ?? "?"} 条分流规则试图授予带权限的用户组 ` +
        `${privileged.join("、")}。按邮箱匹配的规则覆盖的地址是无穷的，注册时无法预留，` +
        `正则写错就会把权限发给一片人；带权限的组只能由列出 uid 的规则授予。`,
    ];
  });
}

export interface TallyableAccount {
  uid: number;
  email: string | null;
}

export interface CohortTally {

  counts: Map<string, number>;

  untagged: number[];
}

export function tallyCohorts(
  accounts: readonly TallyableAccount[],
): CohortTally {
  const counts = new Map<string, number>(
    declaredGroupIds().map((id) => [id, 0]),
  );
  const untagged: number[] = [];

  for (const account of accounts) {
    const resolved = groupsFor(account.uid, account.email);
    if (resolved.length === 0 && account.email) untagged.push(account.uid);
    for (const id of resolved) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return { counts, untagged };
}

/**
 * The groups a uid rule hands out.
 *
 * Exhaustive where it matters: a privileged group may only be granted by uid
 * (`enrollmentPrivilegeViolations` refuses boot otherwise), and a uid rule lists
 * its groups literally. So a privileged group missing from this set is one no
 * account can ever hold — the policy naming it is dead, whether that is a typo
 * or a grant someone removed the other half of.
 *
 * `knownGroups` cannot answer this: it folds in `groups` declarations, which are
 * optional display metadata, and it gives up on pattern rules that compute their
 * groups.
 */
export function grantableGroups(): Set<string> {
  const ids = new Set<string>();

  for (const rule of registry.rules) {
    if (!isUidsRule(rule)) continue;
    for (const id of rule.groups) ids.add(id);
  }

  return ids;
}

export function knownGroups(): { groups: string[]; exhaustive: boolean } {
  const groups = new Set<string>(declaredGroupIds());
  let exhaustive = true;

  for (const rule of registry.rules) {
    if (typeof rule.groups === "function") {
      exhaustive = false;
      continue;
    }
    for (const id of rule.groups) groups.add(id);
  }

  return { groups: [...groups].sort(), exhaustive };
}

export function looseGroupWarnings(): string[] {
  const declared = new Set(declaredGroupIds());

  const fromPatterns = new Set<string>();
  for (const rule of registry.rules) {
    if (isUidsRule(rule) || typeof rule.groups === "function") continue;
    for (const id of rule.groups) fromPatterns.add(id);
  }

  const namedUses = new Map<string, number[]>();
  for (const rule of registry.rules) {
    if (!isUidsRule(rule)) continue;
    for (const id of rule.groups) {
      namedUses.set(id, [...(namedUses.get(id) ?? []), ...rule.uids]);
    }
  }

  return [...namedUses.entries()]
    .filter(([id, uids]) => {
      if (declared.has(id) || fromPatterns.has(id)) return false;
      return uids.length === 1;
    })
    .map(
      ([id, uids]) =>
        `用户组 "${id}" 只在 uid=${uids[0]} 这一条规则里出现过，既没有在 groups 中声明，也不被任何邮箱规则产生。` +
        `如果这是笔误，被授权的人不会得到任何能力。`,
    );
}

export function enrollmentWarnings(): string[] {
  const warnings: string[] = [];

  const privileged = privilegedGroups();
  const admins = registry.rules.filter(
    (rule) => isUidsRule(rule) && rule.groups.some((id) => privileged.has(id)),
  );
  if (admins.length === 0) {
    warnings.push(
      "content/enrollment/ 中没有任何人被授予带权限的用户组，/admin 将无人可进入。",
    );
  }

  if (registry.rules.length === 0) {
    warnings.push(
      "没有配置任何分流规则，注册用户不会进入任何用户组，按组划定参赛范围的比赛将没有参赛者。",
    );
  }

  if (enrollmentPolicy.emailDomains.length === 0) {
    warnings.push(
      "没有限制邮箱域名，任何地址都能注册。如非有意，请设置 policy.emailDomains。",
    );
  }

  warnings.push(...looseGroupWarnings());

  return warnings;
}
