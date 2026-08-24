import { countDistinct } from "drizzle-orm";
import { listAccounts } from "@/lib/accounts/queries";
import { allContests } from "@/lib/contests/registry";
import { db } from "@/lib/db";
import { contests, problems, submissions } from "@/lib/db/schema";
import { enumeratedHandles, groupsFor } from "@/lib/enrollment/registry";
import { backendsSharingSecret, orphanedBackends } from "@/lib/backend/access";
import { mailIsConfigured } from "@/lib/mail/transport";
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
  /**
   * Problems and contests that have ever been submitted to.
   *
   * Not "how much of the registry is mirrored" — nothing pushes the registry
   * into these tables any more. A row appears when a submission first
   * references it, so the count is a floor on how much of the repository has
   * seen use, and the difference from `problemCount` is problems nobody has
   * tried yet.
   */
  mirroredProblems: number;
  mirroredContests: number;
  findings: DriftFinding[];
}

/**
 * Ungated on purpose: this counts every account and every mirror row, so it is
 * not a thing a page may call. `adminOverviewFor` in `./access` is the way in,
 * and it is the only caller.
 */
export async function loadAdminOverview(): Promise<AdminOverview> {
  const registryProblems = allProblems();
  const registryContests = allContests();
  const named = enumeratedHandles();

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

  const findings: DriftFinding[] = [];

  // First, because it is the only one here that means a whole feature is dead
  // rather than that some rows need attention.
  //
  // The failure of an unconfigured relay is not that codes and reset links end
  // up in the container log. Reading that log takes a shell on the deploy
  // host, and whoever has one already has the `.env`, the database and
  // `scripts/set-password.cjs` — the log tells them nothing new. It is that
  // registration and recovery are dead ends that announce themselves as
  // working: the page says a code was sent, every individual send succeeds,
  // and the person waiting on the mail has no way to find out why it will
  // never arrive. Nothing else in the product is in a position to say so,
  // which is why this is the one place that can.
  //
  // A warning rather than a refusal to boot for the same reason the enrollment
  // checks in `instrumentation.ts` are: a deployment with registration closed
  // needs no relay, and an outage would be the worse failure.
  if (!mailIsConfigured()) {
    findings.push({
      severity: "warn",
      title: "未配置 SMTP，邮件只打印到容器日志",
      detail:
        "注册要收验证码、找回密码要收链接，两者现在都只出现在服务端日志里——用户看到「已发送」，然后永远等不到。设置 FOI_SMTP_HOST 等变量即可；若这套部署本就不开放注册，可以忽略。",
      items: [],
    });
  }

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

  // A rule naming a handle is a membership waiting for somebody to claim it,
  // and it is also the only shape that can carry privilege. Before they
  // register there is nobody to give it to, which is normal for a day and a
  // typo if it lasts — the bootstrap administrator is created by
  // `scripts/create-account.cjs` and named here afterwards, so this is where a
  // mistyped handle shows up in between.
  const unclaimed = named.filter((handle) => !accountHandles.has(handle));

  if (unclaimed.length > 0) {
    findings.push({
      severity: "info",
      title: "有规则点名的用户名还没有账号",
      detail:
        "这些用户名在 content/enrollment/ 的规则里被点名，但还没有人注册使用。它们已被注册流程预留，确认拼写无误，或等本人完成注册。",
      items: unclaimed,
    });
  }

  // Mirror rows are written when a submission first references a problem or a
  // contest, so a row with no registry entry means the definition was removed
  // from the repository while its submissions remain.
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

  // Said at startup too, and worth repeating here for the reason every startup
  // warning is easy to miss: it scrolled past weeks ago, in a container whose
  // log has since rotated. This is the surface somebody actually looks at.
  const sharingSecret = backendsSharingSecret();
  if (sharingSecret.length > 0) {
    findings.push({
      severity: "warn",
      title: "有多台题目后端共用同一个签名密钥",
      detail:
        "它们都回落到了共享的 FOI_BACKEND_SECRET，因此任何一台被攻破，它的签名对其余几台同样有效——包括代替它们回报评测结果。为每台服务设置各自的 FOI_BACKEND_<名字>_SECRET 并同步到后端本身；指向同一地址的多个条目是同一个服务，填相同的值即可。",
      items: sharingSecret,
    });
  }

  // A judge nothing routes to is invisible to players by design — the gate
  // shows a judge only to somebody who can see a problem on it — so an
  // unreferenced one would otherwise sit there unnoticed, healthy and unused.
  const unusedJudges = orphanedBackends();
  if (unusedJudges.length > 0) {
    findings.push({
      severity: "info",
      title: "有评测机没有任何题目指向",
      detail:
        "它们不会出现在选手的 /judges 页面（那里只列出承载了可见题目的题目后端）。确认是备用节点还是 backends.config.ts 里的残留。",
      items: unusedJudges,
    });
  }

  if (orphanMirrors.length > 0) {
    findings.push({
      severity: "info",
      title: "有已从仓库删除、但仍被历史提交引用的条目",
      detail:
        "这些行是历史提交的归属锚点，外键为 RESTRICT，删不掉也不该删——没有它们，那些提交就不知道自己属于哪道题。属正常状态。",
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
