import { contestModules } from "@/content/contest-modules";
import { handleSchema, normalizeHandle } from "@/lib/accounts/types";
import { knownGroups } from "@/lib/enrollment/registry";
import { audienceCovers, describeAudience } from "@/lib/permissions/audience";
import { problemBySlug } from "@/lib/problems/registry";
import { getContestRuleset, rulesetFor } from "@/lib/standings/registry";
import { contestConfigSchema, type ContestConfig } from "./types";

function slugFromPath(path: string): string | null {
  return path.match(/\/contests\/([^/]+)\/[^/]+$/)?.[1] ?? null;
}

function buildRegistry(): Map<string, ContestConfig> {
  const registry = new Map<string, ContestConfig>();

  for (const [path, mod] of Object.entries(contestModules)) {
    const dirSlug = slugFromPath(path);
    if (!dirSlug) continue;

    const exported = (mod as { contest?: unknown }).contest;
    if (exported === undefined) {
      throw new Error(`${path} 必须导出名为 contest 的常量`);
    }

    const parsed = contestConfigSchema.safeParse(exported);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(
          (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
        )
        .join("\n");
      throw new Error(`${path} 的比赛配置不合法:\n${issues}`);
    }

    if (parsed.data.slug !== dirSlug) {
      throw new Error(
        `${path} 的 slug "${parsed.data.slug}" 与目录名 "${dirSlug}" 不一致`,
      );
    }

    for (const entry of parsed.data.problems) {
      const problem = problemBySlug(entry.slug);
      if (!problem) {
        throw new Error(
          `${path} 引用了不存在的题目 "${entry.slug}"，请检查 content/problems/`,
        );
      }

      if (!audienceCovers(problem.visibleTo, parsed.data.visibleTo)) {
        throw new Error(
          `${path} 对 ${describeAudience(parsed.data.visibleTo)} 可见，` +
            `但它的题目 "${entry.slug}" 只对 ${describeAudience(problem.visibleTo)} 可见。` +
            `比赛的受众不能超出它任何一道题的受众——否则比赛页会把这道题的标题给到打不开它的人。` +
            `请收窄比赛的 visibleTo，或放宽这道题的。`,
        );
      }
    }

    const own = getContestRuleset(dirSlug);
    const named = parsed.data.ruleset.id;

    if (own && named) {
      throw new Error(
        `${path} 既指定了赛制 "${named}"，同目录下又有 ruleset.tsx。` +
          `两者只能选一个：引用共享模板意味着跟着模板一起演进，自带则与这场比赛一起冻结在 git 里。`,
      );
    }

    const ruleset = rulesetFor(dirSlug, named);
    if (!ruleset) {
      throw new Error(
        named
          ? `${path} 引用了未知的赛制 "${named}"，请检查 content/rulesets/`
          : `${path} 没有指定赛制：写 ruleset.id 引用 content/rulesets/ 里的模板，或在同目录下放一个 ruleset.tsx`,
      );
    }

    if (parsed.data.freezeAt && ruleset.supportsFreeze !== true) {
      throw new Error(
        `${path} 配置了 freezeAt，但赛制 "${ruleset.id}" 不支持封榜，这个字段不会有任何效果。请去掉 freezeAt，或改用支持封榜的赛制。`,
      );
    }

    registry.set(dirSlug, parsed.data);
  }

  return registry;
}

const registry = buildRegistry();

export function allContests(): ContestConfig[] {
  return [...registry.values()].sort(
    (a, b) => b.startsAt.getTime() - a.startsAt.getTime(),
  );
}

export function contestBySlug(slug: string): ContestConfig | undefined {
  return registry.get(slug);
}

export function contestWarnings(): string[] {
  const warnings: string[] = [];
  const { groups, exhaustive } = knownGroups();
  const known = new Set(groups);

  for (const contest of registry.values()) {
    const participants = contest.participants;

    if (participants.mode === "group") {
      if (!exhaustive) continue;
      if (known.has(participants.group)) continue;
      warnings.push(
        `比赛 "${contest.slug}" 的参赛用户组 "${participants.group}" 不会被 content/enrollment/ 中的任何规则或授权产生，排行榜将为空。`,
      );
      continue;
    }

    if (participants.mode !== "list") continue;

    const malformed = participants.handles.filter(
      (handle) => !handleSchema.safeParse(handle.trim()).success,
    );
    if (malformed.length > 0) {
      warnings.push(
        `比赛 "${contest.slug}" 的参赛名单里有不可能属于任何账号的 handle：${malformed.join("、")}。` +
          `用户名只能包含字母、数字、下划线和连字符，长度 2–32，所以这些条目永远不会匹配到人。`,
      );
    }

    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const handle of participants.handles) {
      const normalised = normalizeHandle(handle);
      if (seen.has(normalised)) duplicated.add(normalised);
      else seen.add(normalised);
    }
    if (duplicated.size > 0) {
      warnings.push(
        `比赛 "${contest.slug}" 的参赛名单里有重复的 handle：${[...duplicated].join("、")}。` +
          `名单比对不区分大小写，重复的条目只算一个人。`,
      );
    }
  }

  return warnings;
}
