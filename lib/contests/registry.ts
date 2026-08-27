import { contestModules } from "@/content/_modules/contests";
import { knownGroups } from "@/lib/enrollment/registry";
import { audienceCovers, describeAudience } from "@/lib/permissions/audience";
import { problemBySlug } from "@/lib/problems/registry";
import { slugFromGlobPath } from "@/lib/slug-from-path";
import { rulesetFor } from "@/lib/standings/registry";
import { contestConfigSchema, type ContestConfig } from "./types";

function buildRegistry(): Map<string, ContestConfig> {
  const registry = new Map<string, ContestConfig>();

  for (const [path, mod] of Object.entries(contestModules)) {
    const dirSlug = slugFromGlobPath(path, "contests");
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

    for (const lb of parsed.data.leaderboards) {
      const ruleset = rulesetFor(lb.ruleset.id);
      if (!ruleset) {
        throw new Error(
          `${path} 的排行榜 "${lb.id}" 引用了未知的赛制 "${lb.ruleset.id}"，请检查 content/rulesets/`,
        );
      }
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

    const seen = new Set<number>();
    const duplicated = new Set<number>();
    for (const uid of participants.uids) {
      if (seen.has(uid)) duplicated.add(uid);
      else seen.add(uid);
    }
    if (duplicated.size > 0) {
      warnings.push(
        `比赛 "${contest.slug}" 的参赛名单里有重复的 uid：${[...duplicated].join("、")}。` +
          `重复的条目只算一个人。`,
      );
    }
  }

  return warnings;
}
