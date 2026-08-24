import { contestModules } from "@/content";
import { knownGroups } from "@/lib/enrollment/registry";
import { audienceCovers, describeAudience } from "@/lib/auth/audience";
import { problemBySlug } from "@/lib/problems/registry";
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

    for (const entry of parsed.data.problems) {
      const problem = problemBySlug(entry.slug);
      if (!problem) {
        throw new Error(
          `${path} 引用了不存在的题目 "${entry.slug}"，请检查 content/problems/`,
        );
      }

      // A contest may be narrower than its problems but never wider. If it
      // were, the contest page and the standings would show a title, a link
      // and a column for a problem the reader gets a 404 from — the metadata
      // would leak through the contest while the statement stayed shut, which
      // is not a gate, it is a gap. Refused here rather than filtered at
      // render: dropping a column leaves a total that does not match the
      // columns beside it, and that reads as a bug.
      if (!audienceCovers(problem.visibleTo, parsed.data.visibleTo)) {
        throw new Error(
          `${path} 对 ${describeAudience(parsed.data.visibleTo)} 可见，` +
            `但它的题目 "${entry.slug}" 只对 ${describeAudience(problem.visibleTo)} 可见。` +
            `比赛的受众不能超出它任何一道题的受众——否则比赛页会把这道题的标题给到打不开它的人。` +
            `请收窄比赛的 visibleTo，或放宽这道题的。`,
        );
      }
    }

    const ruleset = getRuleset(parsed.data.ruleset.id);
    if (!ruleset) {
      throw new Error(
        `${path} 引用了未知的赛制 "${parsed.data.ruleset.id}"，请检查 lib/standings/registry.ts`,
      );
    }

    // A `freezeAt` that the format ignores is worse than no freeze at all: the
    // schedule says the board stops updating, and it does not. Nothing showed
    // this before — the config validated, the contest loaded, and the mistake
    // only surfaced when the board failed to freeze during a live round.
    if (parsed.data.freezeAt && !ruleset.supportsFreeze) {
      throw new Error(
        `${path} 配置了 freezeAt，但赛制 "${ruleset.id}" 不支持封榜，这个字段不会有任何效果。请去掉 freezeAt，或改用支持封榜的赛制。`,
      );
    }

    registry.set(dirSlug, parsed.data);
  }

  return registry;
}

const registry = buildRegistry();

/**
 * Every contest as authored, with no view of who is asking.
 *
 * Named for what it is so that reaching for it is a decision. Anything that
 * renders to a person wants `contestsFor()` in `./access`; the callers left
 * here are the ones that legitimately need the whole set — the mirror sync,
 * the drift report, the problem gate's reverse index, and the access layer
 * itself.
 *
 * `visible` is deliberately not filtered here, for the same reason `hidden` is
 * not filtered in the problem registry: it is one of the reasons a contest may
 * be withheld, and keeping one of them here while the rest live in the gate is
 * how they drift apart.
 */
export function allContests(): ContestConfig[] {
  return [...registry.values()].sort(
    (a, b) => b.startsAt.getTime() - a.startsAt.getTime(),
  );
}

/** One contest as authored. Same caveat as `allContests`. */
export function contestBySlug(slug: string): ContestConfig | undefined {
  return registry.get(slug);
}

/**
 * A contest whose group nothing can produce would render as an empty standings
 * table, which looks identical to a contest nobody has entered. Saying so at
 * startup is the closest thing left to the build-time check that used to catch
 * a mistyped handle.
 *
 * Only reported when the rule set is exhaustive. A rule that computes its tags
 * can emit names nothing here can enumerate, and warning about every contest
 * on such a deployment would train people to ignore the warnings.
 */
export function contestWarnings(): string[] {
  const { groups, exhaustive } = knownGroups();
  if (!exhaustive) return [];

  const known = new Set(groups);
  return [...registry.values()]
    .filter(
      (contest) =>
        contest.participants.mode === "group" &&
        !known.has(contest.participants.group),
    )
    .map(
      (contest) =>
        `比赛 "${contest.slug}" 的参赛用户组 "${contest.participants.mode === "group" ? contest.participants.group : ""}" 不会被 content/enrollment/ 中的任何规则或授权产生，排行榜将为空。`,
    );
}
