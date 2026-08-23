import { contestModules } from "@/content";
import { knownTags } from "@/lib/enrollment/registry";
import { hasProblem } from "@/lib/problems/registry";
import { getRuleset } from "@/lib/standings/registry";
import { contestConfigSchema, type ContestConfig } from "./types";

/**
 * Contests are directories under `content/contests/`, mirroring how problems
 * are laid out. A contest owns its schedule, its problem set and the rule for
 * who competes in it, so running a contest is a pull request rather than a
 * sequence of clicks whose outcome nobody can review.
 *
 * References out of a contest — problem slugs, the ruleset id — are resolved
 * here at load time. A typo therefore fails the build instead of producing a
 * standings page that silently omits a column.
 *
 * Two references cannot be checked this strictly any more, because what they
 * point at is data rather than code. A handle in a `list` may belong to
 * somebody who has not registered yet, and a cohort tag may be produced by a
 * rule that computes it from an address. Both are reported by
 * `contestWarnings()` at startup instead of failing the build.
 */
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

    for (const problem of parsed.data.problems) {
      if (!hasProblem(problem.slug)) {
        throw new Error(
          `${path} 引用了不存在的题目 "${problem.slug}"，请检查 content/problems/`,
        );
      }
    }

    if (!getRuleset(parsed.data.ruleset.id)) {
      throw new Error(
        `${path} 引用了未知的赛制 "${parsed.data.ruleset.id}"，请检查 lib/standings/registry.ts`,
      );
    }

    registry.set(dirSlug, parsed.data);
  }

  return registry;
}

const registry = buildRegistry();

export function getContest(slug: string): ContestConfig | undefined {
  return registry.get(slug);
}

export function listContests(options?: {
  includeHidden?: boolean;
}): ContestConfig[] {
  return [...registry.values()]
    .filter((contest) => options?.includeHidden || contest.visible)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}

/**
 * A contest whose tag nothing can produce would render as an empty standings
 * table, which looks identical to a contest nobody has entered. Saying so at
 * startup is the closest thing left to the build-time check that used to catch
 * a mistyped handle.
 *
 * Only reported when the rule set is exhaustive. A rule that computes its tags
 * can emit names nothing here can enumerate, and warning about every contest
 * on such a deployment would train people to ignore the warnings.
 */
export function contestWarnings(): string[] {
  const { tags, exhaustive } = knownTags();
  if (!exhaustive) return [];

  const known = new Set(tags);
  return [...registry.values()]
    .filter(
      (contest) =>
        contest.participants.mode === "tag" &&
        !known.has(contest.participants.tag),
    )
    .map(
      (contest) =>
        `比赛 "${contest.slug}" 的参赛标签 "${contest.participants.mode === "tag" ? contest.participants.tag : ""}" 不会被 content/enrollment/ 中的任何规则产生，排行榜将为空。`,
    );
}
