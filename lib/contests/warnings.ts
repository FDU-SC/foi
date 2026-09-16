import { knownGroups } from "@/lib/enrollment/registry";
import { allProblems } from "@/lib/problems/registry";
import { catalogueSlugs, STANDINGS_SEGMENT } from "./catalogue";
import { orphanedProblems } from "./refs";
import { allContests, catalogueContests, contestBySlug } from "./registry";

/**
 * Problems no contest carries.
 *
 * A problem is reachable only as part of a contest, so one nothing references
 * has no URL, no audience and no way to be submitted to — it is a directory
 * that ships without being part of the site.
 */
export function orphanedProblemComplaints(): string[] {
  const orphans = orphanedProblems(
    allProblems().map((problem) => problem.slug),
  );
  if (orphans.length === 0) return [];

  return [
    `题目 ${orphans.join("、")} 不在任何一场比赛的题单里。`,
  ];
}

/**
 * A problem its own contest's leaderboard page hides.
 *
 * `/problems/<contest>/standings` is a static segment and beats
 * `/problems/<contest>/[slug]`, so this problem has no address at all — the
 * same loss as an orphan, and refused the same way.
 */
export function catalogueComplaints(): string[] {
  return catalogueContests().flatMap((contest) => {
    const shadowed = contest.problems.some(
      (entry) => entry.slug === STANDINGS_SEGMENT,
    );
    if (!shadowed) return [];

    return `题库比赛 "${contest.slug}" 的题单里有题目 "${STANDINGS_SEGMENT}"，会被排行榜页挡住。`;
  });
}

/**
 * A catalogued contest named but not present.
 *
 * Its card is missing from `/problems` and its own addresses answer 404, while
 * the rest of the site is unaffected — alongside a navigation entry pointing at
 * an empty page rather than alongside a broken deployment. It is also the
 * normal state of a content root stripped to its entry points, where `site.ts`
 * survives and the contests do not.
 */
export function catalogueWarnings(): string[] {
  const missing = catalogueSlugs().filter((slug) => !contestBySlug(slug));
  if (missing.length === 0) return [];

  return [
    `catalogue 指向不存在的比赛 ${missing.join("、")}。`,
  ];
}

/**
 * Boot diagnostics for contest configuration.
 *
 * Separate from the registry because it reaches into enrollment, and the
 * registry sits underneath the policy engine that enrollment itself consults.
 */
export function contestWarnings(): string[] {
  const warnings: string[] = [];
  const { groups, exhaustive } = knownGroups();
  const known = new Set(groups);

  for (const contest of allContests()) {
    const participants = contest.participants;

    if (participants.mode === "group") {
      if (!exhaustive) continue;
      if (known.has(participants.group)) continue;
      warnings.push(
        `比赛 "${contest.slug}" 的参赛用户组 "${participants.group}" 没有任何规则会产生。`,
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
        `比赛 "${contest.slug}" 的参赛名单有重复 uid：${[...duplicated].join("、")}。`,
      );
    }
  }

  return warnings;
}
