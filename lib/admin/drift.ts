import { countDistinct } from "drizzle-orm";
import { listAccounts } from "@/lib/accounts/queries";
import { allContests } from "@/lib/contests/registry";
import { db } from "@/lib/db";
import { contests, problems, submissions } from "@/lib/db/schema";
import { groupsFor, listGrants } from "@/lib/enrollment/registry";
import { orphanedJudges } from "@/lib/judge/access";
import { allProblems } from "@/lib/problems/registry";

/**
 * What the operations console is for, now that it cannot edit anything.
 *
 * The interesting question is not "what should I change" but "where has
 * reality drifted from what the repository says". Each finding names a
 * specific divergence and how to resolve it.
 *
 * Two of these used to read the other way round. A credential with no roster
 * entry was once a warning; it is now simply what an ordinary competitor looks
 * like. What replaced it is the mirror image — an address that no cohort rule
 * recognises — because that is the failure this design can actually have: the
 * rules are code and the addresses are data, so a rule that has fallen behind
 * its intake shows up as people quietly belonging to nothing.
 */
export type DriftSeverity = "info" | "warn";

export interface DriftFinding {
  severity: DriftSeverity;
  title: string;
  detail: string;
  items: string[];
}

export interface AdminOverview {
  accountCount: number;
  suspendedCount: number;
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
  const registryProblems = allProblems();
  const registryContests = allContests();
  const grants = listGrants();

  const [accountRows, problemRows, contestRows, submissionStats] =
    await Promise.all([
      listAccounts(),
      db.select({ slug: problems.slug }).from(problems),
      db.select({ slug: contests.slug }).from(contests),
      db
        .select({
          total: countDistinct(submissions.id),
          handles: countDistinct(submissions.handle),
        })
        .from(submissions),
    ]);

  const accountHandles = new Set(accountRows.map((row) => row.handle));
  const mirroredProblemSlugs = new Set(problemRows.map((row) => row.slug));
  const mirroredContestSlugs = new Set(contestRows.map((row) => row.slug));

  const findings: DriftFinding[] = [];

  // The rules are code and the addresses are data, so this is where the two
  // fall out of step: a new intake whose address format nobody added a rule
  // for lands here, silently in no cohort, entered in no contest.
  const untagged = accountRows
    .filter((row) => row.status === "active" && row.email)
    .filter((row) => groupsFor(row.handle, row.email).length === 0)
    .map((row) => row.handle);

  if (untagged.length > 0) {
    findings.push({
      severity: "warn",
      title: "有账号的邮箱不匹配任何分流规则",
      detail:
        "他们不属于任何标签，因此进不了任何 tag 制比赛。多半是 content/enrollment/ 里的规则没跟上新的邮箱格式。",
      items: untagged,
    });
  }

  // A grant is a privilege waiting for somebody to claim it. Before they
  // register there is nobody to give it to, which is normal for a day and a
  // typo if it lasts.
  const unclaimedGrants = grants
    .filter((grant) => !accountHandles.has(grant.handle))
    .map((grant) => grant.handle);

  if (unclaimedGrants.length > 0) {
    findings.push({
      severity: "info",
      title: "有授权尚未对应到账号",
      detail:
        "这些 handle 在 content/enrollment/ 中被授权，但还没有人注册使用。确认拼写无误，或等本人完成注册。",
      items: unclaimedGrants,
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

  // A judge nothing routes to is invisible to players by design — the gate
  // shows a judge only to somebody who can see a problem on it — so an
  // unreferenced one would otherwise sit there unnoticed, healthy and unused.
  const unusedJudges = orphanedJudges();
  if (unusedJudges.length > 0) {
    findings.push({
      severity: "info",
      title: "有判题机没有任何题目指向",
      detail:
        "它们不会出现在选手的 /judges 页面（那里只列出承载了可见题目的判题机）。确认是备用节点还是 judges.config.ts 里的残留。",
      items: unusedJudges,
    });
  }

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
    accountCount: accountRows.length,
    suspendedCount: accountRows.filter((row) => row.status === "suspended")
      .length,
    problemCount: registryProblems.length,
    contestCount: registryContests.length,
    submissionCount: submissionStats[0]?.total ?? 0,
    activeHandles: submissionStats[0]?.handles ?? 0,
    mirroredProblems: problemRows.length,
    mirroredContests: contestRows.length,
    findings,
  };
}
