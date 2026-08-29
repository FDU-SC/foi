import { knownGroups } from "@/lib/enrollment/registry";
import { allContests } from "./registry";

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
