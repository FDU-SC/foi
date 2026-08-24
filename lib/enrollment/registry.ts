import type { z } from "zod";
import { enrollmentModules } from "@/content";
import { normalizeHandle } from "@/lib/accounts/types";
import { declaredGroupIds, isPrivileged, privilegedGroupIds } from "@/lib/auth/groups";
import {
  enrollmentPolicySchema,
  enrollmentRuleSchema,
  grantSchema,
  type EnrollmentPolicy,
  type EnrollmentRule,
  type Grant,
} from "./types";

/**
 * Discovered from the filesystem at build time, exactly like the problem and
 * contest registries: a file under `content/enrollment/` is picked up with no
 * registration step, and Turbopack's watcher reloads it during `next dev`.
 *
 * A module may export any of `policy`, `groups`, `rules` and `grants`, so a
 * deployment can keep what each group may do in one file and who belongs to
 * which in another. Rules accumulate in path order; grants are keyed by handle
 * and a duplicate is an error, because two files disagreeing about somebody's
 * membership should not be settled by whichever loaded second.
 */
interface Registry {
  policy: EnrollmentPolicy;
  rules: EnrollmentRule[];
  grants: Map<string, Grant>;
}

function fail(path: string, what: string, error: z.ZodError): never {
  const issues = error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`${path} 的${what}不合法:\n${issues}`);
}

function buildRegistry(): Registry {
  const rules: EnrollmentRule[] = [];
  const grants = new Map<string, Grant>();
  const grantSources = new Map<string, string>();

  let policy: EnrollmentPolicy | undefined;
  let policySource: string | undefined;

  // Sorted so that rule order — and therefore the order tags come out in — is
  // the same on every machine, rather than whatever the glob happened to emit.
  const paths = Object.keys(enrollmentModules).sort();

  for (const path of paths) {
    const mod = enrollmentModules[path] as {
      policy?: unknown;
      rules?: unknown;
      grants?: unknown;
    };

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

        // The safety property, checked rather than assumed. A computed rule
        // cannot be inspected here, so `groupsForEmail` filters those at
        // resolution; a literal list is caught now, in review, where it is
        // cheapest to fix.
        if (Array.isArray(parsed.data.groups)) {
          const privileged = parsed.data.groups.filter(isPrivileged);
          if (privileged.length > 0) {
            throw new Error(
              `${path} 第 ${index + 1} 条分流规则试图授予带权限的用户组 ${privileged.join("、")}。` +
                `规则按邮箱匹配，正则写错就会把权限发给一片人；带权限的组只能在 grants 里指名道姓地授予。`,
            );
          }
        }

        rules.push(parsed.data);
      });
    }

    if (mod.grants !== undefined) {
      if (!Array.isArray(mod.grants)) {
        throw new Error(`${path} 导出的 grants 必须是数组`);
      }
      mod.grants.forEach((raw, index) => {
        const parsed = grantSchema.safeParse(raw);
        if (!parsed.success) fail(path, `第 ${index + 1} 条授权`, parsed.error);

        const key = normalizeHandle(parsed.data.handle);
        const existing = grantSources.get(key);
        if (existing) {
          throw new Error(
            `授权中的用户名 "${parsed.data.handle}" 重复: ${existing} 与 ${path}（大小写不敏感）`,
          );
        }
        grantSources.set(key, path);
        grants.set(key, parsed.data);
      });
    }
  }

  return {
    policy: policy ?? enrollmentPolicySchema.parse({}),
    rules,
    grants,
  };
}

const registry = buildRegistry();

export const enrollmentPolicy = registry.policy;

export function listRules(): EnrollmentRule[] {
  return registry.rules;
}

/** Case-insensitive, so a handle typed with the wrong capitalisation matches. */
export function getGrant(handle: string): Grant | undefined {
  return registry.grants.get(normalizeHandle(handle));
}

export function listGrants(): Grant[] {
  return [...registry.grants.values()].sort((a, b) =>
    a.handle.localeCompare(b.handle),
  );
}

/**
 * The groups an address puts somebody in.
 *
 * Every matching rule contributes, because somebody is both an undergraduate
 * and a member of the 2023 intake and both facts are worth having. Computed on
 * every read rather than stored on the account: a rule is code, so editing one
 * and deploying re-sorts everybody it applies to on their next request.
 * Storing the answer would turn that into a backfill.
 *
 * Privileged groups are dropped here. A literal list naming one fails at load,
 * but a rule that computes its groups cannot be inspected until it runs — and
 * a regex must never be able to hand out `admin`, however it spells it.
 */
export function groupsForEmail(email: string | null): string[] {
  if (!email) return [];

  const groups = new Set<string>();
  for (const rule of registry.rules) {
    const match = email.match(rule.match);
    if (!match) continue;

    const produced =
      typeof rule.groups === "function" ? rule.groups(match) : rule.groups;
    for (const id of produced) {
      if (isPrivileged(id)) {
        console.warn(
          `[foi] 分流规则「${rule.label}」算出了带权限的用户组 "${id}"，已忽略。带权限的组只能在 grants 里授予。`,
        );
        continue;
      }
      groups.add(id);
    }
  }

  return [...groups];
}

/**
 * Everything one account belongs to: what the address implies, plus whatever a
 * grant adds on top.
 *
 * The single definition matters — `resolveUser` uses it to tell somebody which
 * groups they are in, contest entry uses it to decide who is on the board, and
 * the viewer uses it to decide what they may do. If those disagreed, a
 * competitor would be told they are in a contest they do not appear in.
 */
export function groupsFor(handle: string, email: string | null): string[] {
  const grant = getGrant(handle);
  return [...new Set([...groupsForEmail(email), ...(grant?.groups ?? [])])];
}

/**
 * Every tag the repository can be shown to produce, and whether that set is
 * the whole story.
 *
 * A rule whose tags are computed can produce names nothing here can predict,
 * so `exhaustive` goes false and callers downgrade "this contest references a
 * tag that does not exist" from an error to a warning.
 */
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
  for (const grant of registry.grants.values()) {
    for (const id of grant.groups) groups.add(id);
  }

  return { groups: [...groups].sort(), exhaustive };
}

/**
 * Group names that occur exactly once, in a single grant.
 *
 * Adding a group is meant to cost nothing — write it in a rule or a grant and
 * it exists — and the price of that is a typo being indistinguishable from a
 * new group. `出题員` for `出题人` parses, validates, and silently leaves its
 * holder with no capabilities at all.
 *
 * A name nothing else in the repository refers to is the shape that mistake
 * takes. It is also a legitimate thing to write — a one-off marker on one
 * person — so this is a warning rather than an error, and it names the group
 * so the answer is one glance away.
 */
export function looseGroupWarnings(): string[] {
  const declared = new Set(declaredGroupIds());

  const fromRules = new Set<string>();
  for (const rule of registry.rules) {
    if (typeof rule.groups === "function") continue;
    for (const id of rule.groups) fromRules.add(id);
  }

  const grantUses = new Map<string, string[]>();
  for (const grant of registry.grants.values()) {
    for (const id of grant.groups) {
      grantUses.set(id, [...(grantUses.get(id) ?? []), grant.handle]);
    }
  }

  return [...grantUses.entries()]
    .filter(([id, handles]) => {
      if (declared.has(id) || fromRules.has(id)) return false;
      return handles.length === 1;
    })
    .map(
      ([id, handles]) =>
        `用户组 "${id}" 只在 ${handles[0]} 这一条授权里出现过，既没有在 groups 中声明，也不被任何规则产生。` +
        `如果这是笔误，被授权的人不会得到任何能力。`,
    );
}

/**
 * A deployment nobody can administer is almost always a misconfiguration.
 * Worth saying loudly at startup, but not fatal: `scripts/set-password.cjs`
 * can still recover it, and refusing to boot would turn a bad config into an
 * outage.
 */
export function enrollmentWarnings(): string[] {
  const warnings: string[] = [];

  const privileged = new Set(privilegedGroupIds());
  const admins = listGrants().filter((grant) =>
    grant.groups.some((id) => privileged.has(id)),
  );
  if (admins.length === 0) {
    warnings.push(
      "content/enrollment/ 中没有任何人被授予带权限的用户组，/admin 将无人可进入。",
    );
  }

  if (registry.rules.length === 0) {
    warnings.push(
      "没有配置任何邮箱分流规则，注册用户不会进入任何用户组，按组划定参赛范围的比赛将没有参赛者。",
    );
  }

  if (enrollmentPolicy.enabled && enrollmentPolicy.emailDomains.length === 0) {
    warnings.push(
      "注册已开启但没有限制邮箱域名，任何人都可以注册。如非有意，请设置 policy.emailDomains。",
    );
  }

  warnings.push(...looseGroupWarnings());

  return warnings;
}
