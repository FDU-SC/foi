import type { z } from "zod";
import { normalizeHandle } from "@/lib/accounts/types";
import { declaredGroupIds, isPrivileged, privilegedGroupIds } from "@/lib/auth/groups";
import { enrollmentSources } from "./modules";
import {
  enrollmentPolicySchema,
  enrollmentRuleSchema,
  isHandlesRule,
  privilegeAllowed,
  retiredPolicyKey,
  type EnrollmentPolicy,
  type EnrollmentRule,
} from "./types";

/**
 * Discovered from the filesystem at build time, exactly like the problem and
 * contest registries: a file under `content/enrollment/` is picked up with no
 * registration step, and Turbopack's watcher reloads it during `next dev`.
 *
 * A module may export `policy` and `rules`, so a deployment can keep what each
 * group may do in one file and who belongs to which in another. Rules
 * accumulate in path order, and every matching one contributes — somebody is
 * both an undergraduate and a member of the 2023 intake, and both facts are
 * worth having. Two rules naming the same handle is therefore allowed and
 * means the union: one file can put somebody in the setters' group while
 * another puts them in a cohort.
 */
interface Registry {
  policy: EnrollmentPolicy;
  rules: EnrollmentRule[];
  /** Every rule that names a given handle, keyed by its canonical spelling. */
  handleIndex: Map<string, EnrollmentRule[]>;
  /**
   * Whether any file under `content/enrollment/` was found at all.
   *
   * Not the same question as whether `policy` holds defaults. A deployment can
   * ship rules and no policy block and still mean every default it inherits;
   * one that ships nothing has not inherited them, it has said nothing, and
   * the difference matters to anything that would otherwise treat a default as
   * a declaration — see `assertMailDelivery`, which refuses a production boot
   * over `mailDelivery` and must not do so over a value the kernel picked on
   * behalf of a deployment with no content.
   */
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
  const handleIndex = new Map<string, EnrollmentRule[]>();

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
      // Before parsing, because `z.object` strips what it does not know
      // rather than complaining, and a retired key deserves an answer.
      const retired = retiredPolicyKey(mod.policy);
      if (retired) throw new Error(`${path} ${retired}`);

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

        // The safety property, checked rather than assumed. A computed rule
        // cannot be inspected here, so `groupsFor` filters those at
        // resolution; a literal list is caught now, in review, where it is
        // cheapest to fix.
        if (!privilegeAllowed(rule) && Array.isArray(rule.groups)) {
          const privileged = rule.groups.filter(isPrivileged);
          if (privileged.length > 0) {
            throw new Error(
              `${path} 第 ${index + 1} 条分流规则试图授予带权限的用户组 ${privileged.join("、")}。` +
                `按邮箱匹配的规则覆盖的地址是无穷的，注册时无法预留，正则写错就会把权限发给一片人；` +
                `带权限的组只能由列出 handles 的规则授予，那些用户名会被注册流程占住。`,
            );
          }
        }

        if (isHandlesRule(rule)) {
          for (const handle of rule.handles) {
            const key = normalizeHandle(handle);
            handleIndex.set(key, [...(handleIndex.get(key) ?? []), rule]);
          }
        }

        rules.push(rule);
      });
    }
  }

  return {
    policy: policy ?? enrollmentPolicySchema.parse({}),
    rules,
    handleIndex,
    declared: sources.length > 0,
  };
}

const registry = buildRegistry();

export const enrollmentPolicy = registry.policy;

/** Whether this deployment ships any enrolment content. See `Registry`. */
export const enrollmentDeclared: boolean = registry.declared;

export function listRules(): EnrollmentRule[] {
  return registry.rules;
}

/**
 * Every rule that names this handle. Case-insensitive, so a handle typed with
 * the wrong capitalisation matches.
 *
 * Also what `handleAvailable` consults: a handle a rule names is a privilege
 * waiting to be claimed, and letting a stranger register it first would hand
 * them the group the rule was written for.
 */
export function rulesForHandle(handle: string): EnrollmentRule[] {
  return registry.handleIndex.get(normalizeHandle(handle)) ?? [];
}

/** Every handle any rule names, for the operations console. */
export function enumeratedHandles(): string[] {
  return [...registry.handleIndex.keys()].sort();
}

/**
 * The groups an account belongs to.
 *
 * Every matching rule contributes, because somebody is both an undergraduate
 * and a member of the 2023 intake and both facts are worth having. Computed on
 * every read rather than stored on the account: a rule is code, so editing one
 * and deploying re-sorts everybody it applies to on their next request.
 * Storing the answer would turn that into a backfill.
 *
 * The single definition matters — `resolveUser` uses it to tell somebody which
 * groups they are in, contest entry uses it to decide who is on the board, and
 * the viewer uses it to decide what they may do. If those disagreed, a
 * competitor would be told they are in a contest they do not appear in.
 *
 * Privileged groups from an address rule are dropped here. A literal list
 * naming one fails at load, but a rule that computes its groups cannot be
 * inspected until it runs — and a regex must never be able to hand out
 * `admin`, however it spells it.
 */
export function groupsFor(handle: string, email: string | null): string[] {
  const groups = new Set<string>();

  // Which rules name this handle is an index lookup; the loop below still goes
  // in declaration order, so the groups come out the same on every machine.
  // This runs on every request and once per account in the console's cohort
  // counts, so it is worth not rescanning every handle list.
  const named = new Set(rulesForHandle(handle));

  for (const rule of registry.rules) {
    let produced: readonly string[];

    if (isHandlesRule(rule)) {
      if (!named.has(rule)) continue;
      produced = rule.groups;
    } else {
      if (!email) continue;
      const match = email.match(rule.email);
      if (!match) continue;
      produced =
        typeof rule.groups === "function" ? rule.groups(match) : rule.groups;
    }

    const mayGrantPrivilege = privilegeAllowed(rule);
    for (const id of produced) {
      if (!mayGrantPrivilege && isPrivileged(id)) {
        console.warn(
          `[foi] 分流规则「${rule.label}」算出了带权限的用户组 "${id}"，已忽略。带权限的组只能由列出 handles 的规则授予。`,
        );
        continue;
      }
      groups.add(id);
    }
  }

  return [...groups];
}

/** What `tallyCohorts` needs off an account, and nothing more. */
export interface TallyableAccount {
  handle: string;
  email: string | null;
}

export interface CohortTally {
  /**
   * Accounts in each group. Declared groups start at zero so they are listed
   * even when empty — that is the value of the console's card right after
   * somebody adds a group: a count of 0 next to a name you just wrote is how a
   * mistyped group announces itself, and absence from the list would not.
   */
  counts: Map<string, number>;
  /**
   * Handles whose address no rule recognises, in the order given.
   *
   * Only accounts that have an address at all: an account with none cannot be
   * matched by a cohort rule and is not evidence of a rule falling behind.
   */
  untagged: string[];
}

/**
 * Every given account run through `groupsFor` once, counted and listed.
 *
 * Both readings come out of one pass. `lib/admin/drift.ts` wants the untagged
 * handles and `enrollmentViewFor` wants the count of them; computing them
 * separately is a full scan of the rule set per account done twice, and two
 * spellings of "no rule recognises this address" is the shape a drift finding
 * and a console counter come to disagree in.
 *
 * The caller decides which accounts to pass — both callers pass the active
 * ones, and neither would be right for the other's set.
 */
export function tallyCohorts(
  accounts: readonly TallyableAccount[],
): CohortTally {
  const counts = new Map<string, number>(
    declaredGroupIds().map((id) => [id, 0]),
  );
  const untagged: string[] = [];

  for (const account of accounts) {
    const resolved = groupsFor(account.handle, account.email);
    if (resolved.length === 0 && account.email) untagged.push(account.handle);
    for (const id of resolved) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return { counts, untagged };
}

/**
 * Every group the repository can be shown to produce, and whether that set is
 * the whole story.
 *
 * A rule whose groups are computed can produce names nothing here can predict,
 * so `exhaustive` goes false and callers downgrade "this contest references a
 * group that does not exist" from an error to a warning.
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

  return { groups: [...groups].sort(), exhaustive };
}

/**
 * Group names that occur exactly once, in a single rule naming one person.
 *
 * Adding a group is meant to cost nothing — write it in a rule and it exists —
 * and the price of that is a typo being indistinguishable from a new group.
 * `出题員` for `出题人` parses, validates, and silently leaves its holder with
 * no capabilities at all.
 *
 * A name nothing else in the repository refers to is the shape that mistake
 * takes. It is also a legitimate thing to write — a one-off marker on one
 * person — so this is a warning rather than an error, and it names the group
 * so the answer is one glance away.
 */
export function looseGroupWarnings(): string[] {
  const declared = new Set(declaredGroupIds());

  const fromPatterns = new Set<string>();
  for (const rule of registry.rules) {
    if (isHandlesRule(rule) || typeof rule.groups === "function") continue;
    for (const id of rule.groups) fromPatterns.add(id);
  }

  const namedUses = new Map<string, string[]>();
  for (const rule of registry.rules) {
    if (!isHandlesRule(rule)) continue;
    for (const id of rule.groups) {
      namedUses.set(id, [...(namedUses.get(id) ?? []), ...rule.handles]);
    }
  }

  return [...namedUses.entries()]
    .filter(([id, handles]) => {
      if (declared.has(id) || fromPatterns.has(id)) return false;
      return handles.length === 1;
    })
    .map(
      ([id, handles]) =>
        `用户组 "${id}" 只在 ${handles[0]} 这一条规则里出现过，既没有在 groups 中声明，也不被任何邮箱规则产生。` +
        `如果这是笔误，被授权的人不会得到任何能力。`,
    );
}

/**
 * A deployment nobody can administer is almost always a misconfiguration.
 * Worth saying loudly at startup, but not fatal: `scripts/create-account.cjs`
 * can still recover it, and refusing to boot would turn a bad config into an
 * outage.
 */
export function enrollmentWarnings(): string[] {
  const warnings: string[] = [];

  const privileged = new Set(privilegedGroupIds());
  const admins = registry.rules.filter(
    (rule) => isHandlesRule(rule) && rule.groups.some((id) => privileged.has(id)),
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

  if (enrollmentPolicy.enabled && enrollmentPolicy.emailDomains.length === 0) {
    warnings.push(
      "注册已开启但没有限制邮箱域名，任何人都可以注册。如非有意，请设置 policy.emailDomains。",
    );
  }

  warnings.push(...looseGroupWarnings());

  return warnings;
}
