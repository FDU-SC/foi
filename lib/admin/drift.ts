import { countDistinct } from "drizzle-orm";
import { listCredentials } from "@/lib/auth/credentials";
import { listContests } from "@/lib/contests/registry";
import { db } from "@/lib/db";
import { contests, problems, submissions } from "@/lib/db/schema";
import { listProblems } from "@/lib/problems/registry";
import { hasMember, listMembers } from "@/lib/roster/registry";

/**
 * What the operations console is for now that it cannot edit anything.
 *
 * With the repository as the source of truth, the interesting question is no
 * longer "what should I change" but "where has reality drifted from what the
 * repository says". Each finding below names a specific divergence and how to
 * resolve it — usually a pull request, occasionally a setup code.
 */
export type DriftSeverity = "info" | "warn";

export interface DriftFinding {
  severity: DriftSeverity;
  title: string;
  detail: string;
  items: string[];
}

export interface AdminOverview {
  rosterSize: number;
  problemCount: number;
  contestCount: number;
  submissionCount: number;
  /** Distinct handles that have ever submitted. */
  activeHandles: number;
  mirroredProblems: number;
  mirroredContests: number;
  findings: DriftFinding[];
}

export async function loadAdminOverview(): Promise<AdminOverview> {
  const roster = listMembers({ includeDisabled: true });
  const registryProblems = listProblems({ includeHidden: true });
  const registryContests = listContests({ includeHidden: true });

  const [credentialRows, problemRows, contestRows, submissionStats] =
    await Promise.all([
      listCredentials(),
      db.select({ slug: problems.slug }).from(problems),
      db.select({ slug: contests.slug }).from(contests),
      db
        .select({
          total: countDistinct(submissions.id),
          handles: countDistinct(submissions.handle),
        })
        .from(submissions),
    ]);

  const credentialHandles = new Set(credentialRows.map((row) => row.handle));
  const mirroredProblemSlugs = new Set(problemRows.map((row) => row.slug));
  const mirroredContestSlugs = new Set(contestRows.map((row) => row.slug));

  const findings: DriftFinding[] = [];

  // Someone on the roster who has never been given a way to log in. Expected
  // right after adding people; the fix is a setup code, not a schema change.
  const withoutCredentials = roster
    .filter((member) => !member.disabled)
    .filter((member) => {
      const row = credentialRows.find((entry) => entry.handle === member.handle);
      return !row?.hasPassword;
    })
    .map((member) => member.handle);

  if (withoutCredentials.length > 0) {
    findings.push({
      severity: "info",
      title: "名册中有人尚未设置密码",
      detail: "在「凭据」页为他们签发一次性设置码。",
      items: withoutCredentials,
    });
  }

  // The reverse: a credential outliving its roster entry. Harmless but worth
  // surfacing, because it is the residue of someone having left.
  const orphanCredentials = [...credentialHandles].filter(
    (handle) => !hasMember(handle),
  );
  if (orphanCredentials.length > 0) {
    findings.push({
      severity: "warn",
      title: "有凭据不在名册中",
      detail:
        "这些用户已从 content/roster/ 移除，无法登录。确认其提交记录无需保留后，可用 scripts/set-password.cjs --revoke 清理。",
      items: orphanCredentials,
    });
  }

  const unmirroredProblems = registryProblems
    .filter((problem) => !mirroredProblemSlugs.has(problem.slug))
    .map((problem) => problem.slug);
  const unmirroredContests = registryContests
    .filter((contest) => !mirroredContestSlugs.has(contest.slug))
    .map((contest) => contest.slug);

  if (unmirroredProblems.length > 0 || unmirroredContests.length > 0) {
    findings.push({
      severity: "info",
      title: "注册表尚未同步到镜像表",
      detail: "点击上方「立即同步」，或重启服务。",
      items: [...unmirroredProblems, ...unmirroredContests],
    });
  }

  // Sync never deletes, so a mirror row with no registry entry means the
  // definition was removed from the repository while its submissions remain.
  const registryProblemSlugs = new Set(registryProblems.map((p) => p.slug));
  const registryContestSlugs = new Set(registryContests.map((c) => c.slug));

  const orphanMirrors = [
    ...problemRows
      .filter((row) => !registryProblemSlugs.has(row.slug))
      .map((row) => `题目 ${row.slug}`),
    ...contestRows
      .filter((row) => !registryContestSlugs.has(row.slug))
      .map((row) => `比赛 ${row.slug}`),
  ];

  if (orphanMirrors.length > 0) {
    findings.push({
      severity: "warn",
      title: "镜像表中有已从仓库删除的条目",
      detail:
        "同步不会删除镜像行，以免历史提交失去归属。确认无需保留后再手动清理。",
      items: orphanMirrors,
    });
  }

  return {
    rosterSize: roster.length,
    problemCount: registryProblems.length,
    contestCount: registryContests.length,
    submissionCount: submissionStats[0]?.total ?? 0,
    activeHandles: submissionStats[0]?.handles ?? 0,
    mirroredProblems: problemRows.length,
    mirroredContests: contestRows.length,
    findings,
  };
}
