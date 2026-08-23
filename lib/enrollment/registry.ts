import type { z } from "zod";
import { enrollmentModules } from "@/content";
import { normalizeHandle } from "@/lib/accounts/types";
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
 * A module may export any of `policy`, `rules` and `grants`, so a deployment
 * can keep its cohort rules in one file and its staff list in another. Rules
 * accumulate in path order; grants are keyed by handle and a duplicate is an
 * error, because two files disagreeing about somebody's role should not be
 * settled by whichever loaded second.
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
 * The cohorts an address belongs to.
 *
 * Every matching rule contributes, because somebody is both an undergraduate
 * and a member of the 2023 intake and both facts are worth having. Computed on
 * every read rather than stored on the account: a rule is code, so editing one
 * and deploying re-sorts everybody it applies to on their next request, the
 * same way a change to `lib/auth/policy.ts` does. Storing the answer would
 * turn that into a backfill.
 */
export function tagsForEmail(email: string | null): string[] {
  if (!email) return [];

  const tags = new Set<string>();
  for (const rule of registry.rules) {
    const match = email.match(rule.match);
    if (!match) continue;

    const produced =
      typeof rule.tags === "function" ? rule.tags(match) : rule.tags;
    for (const tag of produced) tags.add(tag);
  }

  return [...tags];
}

/**
 * Everything one account belongs to: derived from the address, plus whatever a
 * grant adds on top.
 *
 * The single definition matters — `resolveUser` uses it to tell somebody which
 * cohorts they are in, and contest entry uses it to decide who is on the
 * board. If those two ever disagreed, a competitor would be told they are in a
 * contest they do not appear in.
 */
export function tagsFor(handle: string, email: string | null): string[] {
  const grant = getGrant(handle);
  return [...new Set([...tagsForEmail(email), ...(grant?.tags ?? [])])];
}

/**
 * Every tag the repository can be shown to produce, and whether that set is
 * the whole story.
 *
 * A rule whose tags are computed can produce names nothing here can predict,
 * so `exhaustive` goes false and callers downgrade "this contest references a
 * tag that does not exist" from an error to a warning.
 */
export function knownTags(): { tags: string[]; exhaustive: boolean } {
  const tags = new Set<string>();
  let exhaustive = true;

  for (const rule of registry.rules) {
    if (typeof rule.tags === "function") {
      exhaustive = false;
      continue;
    }
    for (const tag of rule.tags) tags.add(tag);
  }
  for (const grant of registry.grants.values()) {
    for (const tag of grant.tags) tags.add(tag);
  }

  return { tags: [...tags].sort(), exhaustive };
}

/**
 * A deployment nobody can administer is almost always a misconfiguration.
 * Worth saying loudly at startup, but not fatal: `scripts/set-password.cjs`
 * can still recover it, and refusing to boot would turn a bad config into an
 * outage.
 */
export function enrollmentWarnings(): string[] {
  const warnings: string[] = [];

  const admins = listGrants().filter((grant) => grant.role === "admin");
  if (admins.length === 0) {
    warnings.push(
      "content/enrollment/ 中没有任何 admin 授权，/admin 将无人可进入。",
    );
  }

  if (registry.rules.length === 0) {
    warnings.push(
      "没有配置任何邮箱分流规则，注册用户不会获得任何标签，tag 制比赛将没有参赛者。",
    );
  }

  if (enrollmentPolicy.enabled && enrollmentPolicy.emailDomains.length === 0) {
    warnings.push(
      "注册已开启但没有限制邮箱域名，任何人都可以注册。如非有意，请设置 policy.emailDomains。",
    );
  }

  return warnings;
}
