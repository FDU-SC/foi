import { contestModules } from "@/content/_modules/contests";
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
      if (problemBySlug(entry.slug)) continue;
      throw new Error(
        `${path} 引用了不存在的题目 "${entry.slug}"，请检查 content/problems/`,
      );
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
