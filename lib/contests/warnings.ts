import { knownGroups } from "@/lib/enrollment/registry";
import { allProblems } from "@/lib/problems/registry";
import { catalogueSlug, STANDINGS_SEGMENT } from "./catalogue";
import { orphanedProblems } from "./refs";
import { allContests, catalogueContest } from "./registry";

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
    `题目 ${orphans.join("、")} 不在任何一场比赛的题单里，没有人打得开它们。` +
      `把它们加进某场比赛的 problems，或删掉这些目录。`,
  ];
}

/**
 * A problem the catalogue's own leaderboard page hides.
 *
 * `/problems/standings` is a static segment and beats `/problems/[slug]`, so
 * this problem has no address at all — the same loss as an orphan, and refused
 * the same way.
 */
export function catalogueComplaints(): string[] {
  const contest = catalogueContest();
  if (!contest) return [];

  const shadowed = contest.problems.some(
    (entry) => entry.slug === STANDINGS_SEGMENT,
  );
  if (!shadowed) return [];

  return [
    `题库比赛 "${contest.slug}" 的题单里有题目 "${STANDINGS_SEGMENT}"，` +
      `它会被排行榜页 /problems/${STANDINGS_SEGMENT} 挡住，永远打不开。给这道题换个 slug。`,
  ];
}

/**
 * A catalogue named but not present.
 *
 * Every `/problems` address answers 404 and the rest of the site is unaffected,
 * which puts it alongside a navigation entry pointing at an empty page rather
 * than alongside a broken deployment. It is also the normal state of a content
 * root stripped to its entry points, where `site.ts` survives and the contests
 * do not.
 */
export function catalogueWarnings(): string[] {
  const named = catalogueSlug();
  if (named === undefined || catalogueContest()) return [];

  return [
    `content/site.ts 的 catalogue 指向比赛 "${named}"，但 content/contests/ 里没有它，` +
      `/problems 下的每个地址都会是 404。改掉这个 slug，或去掉 catalogue。`,
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
