import { knownGroups } from "@/lib/enrollment/registry";
import { allProblems } from "@/lib/problems/registry";
import { orphanedProblems } from "./refs";
import { allContests } from "./registry";

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
