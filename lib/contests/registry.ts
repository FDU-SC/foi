import { contestModules } from "@/content-contest-modules";
import { handleSchema, normalizeHandle } from "@/lib/accounts/types";
import { knownGroups } from "@/lib/enrollment/registry";
import { audienceCovers, describeAudience } from "@/lib/auth/audience";
import { problemBySlug } from "@/lib/problems/registry";
import { getContestRuleset, rulesetFor } from "@/lib/standings/registry";
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

    // A `freezeAt` that the format ignores is worse than no freeze at all: the
    // schedule says the board stops updating, and it does not. Nothing showed
    // this before — the config validated, the contest loaded, and the mistake
    // only surfaced when the board failed to freeze during a live round.
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
 * Entry rules that name something nothing can ever satisfy.
 *
 * Both modes render as an empty standings table, which looks identical to a
 * contest nobody has entered. Saying so at startup is the closest thing left to
 * the build-time check that used to catch a mistyped reference.
 *
 * The two checks are gated differently, and that is the point of separating
 * them. A group name is only checkable when the rule set is exhaustive — a rule
 * that computes its tags can emit names nothing here can enumerate, and warning
 * about every contest on such a deployment would train people to ignore the
 * warnings. A handle does not depend on the rules at all, so a short-circuit on
 * `exhaustive` was silently taking the handle check down with it.
 *
 * What the handle check can say is narrower than "this person exists": accounts
 * are data, and a handle in a `list` legitimately belongs to somebody who has
 * not registered yet. What it can say is that a handle no account may ever
 * *have* — one `handleSchema` refuses — will never match anybody however long
 * you wait.
 */
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

    // `canEnterContest` compares normalised handles, so two spellings of one
    // person are one entrant. Harmless for entry and misleading everywhere the
    // list is counted — the console prints its length as 参赛人数.
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
