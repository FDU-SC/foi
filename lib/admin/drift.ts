import { countDistinct } from "drizzle-orm";
import { listAccounts } from "@/lib/accounts/queries";
import { savedBootWarnings } from "@/lib/boot/checks";
import { allContests } from "@/lib/contests/registry";
import { db } from "@/lib/db";
import { contests, problems, submissions } from "@/lib/db/schema";
import { enumeratedUids, tallyCohorts } from "@/lib/enrollment/registry";
import { orphanedBackends } from "@/lib/backend/access";
import { reaperHealth, recentDisruptions } from "@/lib/runner/reaper";
import { allProblems } from "@/lib/problems/registry";

export type DriftSeverity = "info" | "warn";

const DISRUPTION_WINDOW_MS = 60 * 60 * 1000;

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

  activeUids: number;

  mirroredProblems: number;
  mirroredContests: number;
  findings: DriftFinding[];
}

export async function loadAdminOverview(): Promise<AdminOverview> {
  const registryProblems = allProblems();
  const registryContests = allContests();
  const namedUids = enumeratedUids();

  const [accountRows, problemRows, contestRows, submissionStats] =
    await Promise.all([
      listAccounts(),
      db.select({ slug: problems.slug }).from(problems),
      db.select({ slug: contests.slug }).from(contests),
      db
        .select({
          total: countDistinct(submissions.id),
          uids: countDistinct(submissions.uid),
        })
        .from(submissions),
    ]);

  const accountUids = new Set(accountRows.map((row) => row.uid));

  const findings: DriftFinding[] = [];

  const bootWarnings = savedBootWarnings();
  if (bootWarnings.length > 0) {
    findings.push({
      severity: "warn",
      title: "启动时发现的配置提醒",
      detail:
        "应用启动时记录了以下配置问题。",
      items: bootWarnings,
    });
  }

  const { untagged } = tallyCohorts(
    accountRows.filter((row) => row.status === "active"),
  );

  if (untagged.length > 0) {
    findings.push({
      severity: "warn",
      title: "有账号的邮箱不匹配任何分流规则",
      detail:
        "这些账号未分配用户组，无法参加限定用户组的比赛。",
      items: untagged.map(String),
    });
  }

  const unclaimed = namedUids.filter((uid) => !accountUids.has(uid));

  if (unclaimed.length > 0) {
    findings.push({
      severity: "info",
      title: "分流规则中有不存在的账号",
      detail:
        "以下用户编号未匹配到账号。",
      items: unclaimed.map(String),
    });
  }

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

  const reaper = reaperHealth();
  if (!reaper.ok) {
    findings.push({
      severity: "warn",
      title: "评测任务回收未按时完成",
      detail:
        "失联评测机的任务回收、重试耗尽和排队超时处理可能受影响。",
      items: [
        reaper.ranAt
          ? `最后一次回收：${reaper.ranAt.toISOString()}`
          : "当前进程尚未完成任务回收",
      ],
    });
  }

  const disrupted = await recentDisruptions(DISRUPTION_WINDOW_MS);
  if (disrupted > 0) {
    findings.push({
      severity: "warn",
      title: "近期有评测中断的提交",
      detail:
        "这些提交没有评测结果，不计入成绩。查看中断原因，修复后重新评测。",
      items: [`最近一小时 ${disrupted} 条`],
    });
  }

  const unusedJudges = orphanedBackends();
  if (unusedJudges.length > 0) {
    findings.push({
      severity: "info",
      title: "有未关联题目的评测后端",
      detail:
        "选手只能查看关联了可见题目的评测队列，以下后端不在其中。",
      items: unusedJudges,
    });
  }

  if (orphanMirrors.length > 0) {
    findings.push({
      severity: "info",
      title: "有已移除题目或比赛的历史记录",
      detail:
        "正常保留数据，用于记录历史提交的题目和比赛归属。",
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
    activeUids: submissionStats[0]?.uids ?? 0,
    mirroredProblems: problemRows.length,
    mirroredContests: contestRows.length,
    findings,
  };
}
