import { contestModules } from "@/content/_modules/contests";
import { problemBySlug } from "@/lib/problems/registry";
import { libraryLinksIn } from "@/lib/problems/library";
import { slugFromGlobPath } from "@/lib/slug-from-path";
import { rulesetFor } from "@/lib/standings/registry";
import { issueList } from "@/lib/validation";
import { catalogueSlugs } from "./catalogue";
import {
  contestConfigSchema,
  type ContestConfig,
  type ContestProblemConfig,
} from "./types";

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
      throw new Error(`${path} 的比赛配置不合法:\n${issueList(parsed.error)}`);
    }

    if (parsed.data.slug !== dirSlug) {
      throw new Error(
        `${path} 的 slug "${parsed.data.slug}" 与目录名 "${dirSlug}" 不一致`,
      );
    }

    for (const entry of parsed.data.problems) {
      if (problemBySlug(entry.slug)) continue;
      throw new Error(
        `${path} 引用了不存在的题目 "${entry.slug}"`,
      );
    }

    for (const lb of parsed.data.leaderboards) {
      const ruleset = rulesetFor(lb.ruleset.id);
      if (!ruleset) {
        throw new Error(
          `${path} 的排行榜 "${lb.id}" 引用了未知的赛制 "${lb.ruleset.id}"`,
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

/**
 * The contest's problem list: what `contest.ts` declares, plus the problems
 * authored here that were put in this contest.
 *
 * A contest is repository content, and an image that has been built cannot edit
 * it. So an authored problem's belonging is a `problem_contests` row instead,
 * appended after the declared entries in `position` order — the declared list
 * keeps the order it was written in, and a new problem lands at the tail, which
 * is where a catalogue's "newest" sort looks for it.
 *
 * This is the only merge point. Everything that builds a (contest, problem) pair
 * reads the list through here, so an authored problem has exactly one URL, and
 * removing it from a contest is deleting a row rather than editing a file.
 */
export function contestProblemsOf(
  contest: ContestConfig,
): ContestProblemConfig[] {
  const links = libraryLinksIn(contest.slug);
  if (links.length === 0) return contest.problems;

  const declared = new Set(contest.problems.map((entry) => entry.slug));

  return [
    ...contest.problems,
    ...links
      .filter((link) => !declared.has(link.slug))
      .map((link) =>
        link.label === null
          ? { slug: link.slug }
          : { slug: link.slug, label: link.label },
      ),
  ];
}

/**
 * The contests `site.catalogue` names, in the order it names them.
 *
 * A name with no contest behind it is skipped rather than reported here — that
 * is a boot diagnostic, and `lib/contests/warnings.ts` owns it.
 */
export function catalogueContests(): ContestConfig[] {
  return catalogueSlugs().flatMap((slug) => registry.get(slug) ?? []);
}
