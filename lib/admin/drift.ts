import { countDistinct } from "drizzle-orm";
import { listAccounts } from "@/lib/accounts/queries";
import { tier } from "@/lib/boot/deployment";
import { allContests } from "@/lib/contests/registry";
import { db } from "@/lib/db";
import { contests, problems, submissions } from "@/lib/db/schema";
import { enumeratedHandles, tallyCohorts } from "@/lib/enrollment/registry";
import { orphanedBackends } from "@/lib/backend/access";
import {
  backendsMissingActionUrl,
  backendsOnLoopback,
  backendsSharingSecret,
} from "@/lib/backend/boot";
import { reaperHealth, recentDisruptions } from "@/lib/runner/reaper";
import { mailDeliveryUnmet } from "@/lib/mail/transport";
import { allProblems } from "@/lib/problems/registry";

/**
 * What the operations console is for, now that it cannot edit anything.
 *
 * The interesting question is not "what should I change" but "where has
 * reality drifted from what the repository says". Each finding names a
 * specific divergence and how to resolve it.
 *
 * A credential with no roster entry is not one of them — that is what an
 * ordinary competitor looks like. The mirror image is: the rules are code and
 * the addresses are data, so a rule that has fallen behind its intake shows up
 * as people quietly belonging to nothing.
 */
export type DriftSeverity = "info" | "warn";

/**
 * How far back the disrupted count below looks.
 *
 * An hour, because the finding is about a rate rather than a total: it should
 * appear while a bad runner is still bad and disappear once it has been fixed,
 * without an operator having to remember what the number was yesterday.
 */
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
  // The failure is not that codes and reset links end up in the container log.
  // Reading that log takes a shell on the deploy host, and whoever has one
  // already has the `.env`, the database and `scripts/set-password.cjs` — the
  // log tells them nothing new. It is that registration and recovery are dead
  // ends that announce themselves as working: the page says a code was sent,
  // every individual send succeeds, and the person waiting on the mail has no
  // way to find out why it will never arrive. Nothing else in the product is
  // in a position to say so, which is why this is the one place that can.
  //
  // Asked of the mail module rather than of `FOI_SMTP_HOST`, which is the
  // whole reason `policy.mailDelivery` exists: where mail goes is a
  // declaration, not an inference from an absent variable. Reading the
  // variable tells a deployment that wrote `mailDelivery: "console"` on
  // purpose to fix a decision it made, at every visit, and a list whose first
  // entry can never be resolved is a list that gets skimmed past.
  //
  // Barely reachable on prod, because the boot check refuses that tier. So this
  // mostly repeats a startup warning, for the reason the shared-key finding
  // below does: a startup warning scrolled past weeks ago, in a log that has
  // since rotated. On staging it is the ordinary case rather than a near-miss —
  // that tier falls back to the console on purpose.
  if (mailDeliveryUnmet()) {
    findings.push({
      severity: "warn",
      title: "声明了要发信，却没有可用的 SMTP 中继",
      detail:
        'content/enrollment/ 的 policy 声明了 mailDelivery: "smtp"，但没有设置 FOI_SMTP_HOST——注册的验证码、找回密码的链接都只会打印到服务端日志里，用户看到「已发送」，然后永远等不到。设置 FOI_SMTP_HOST 等变量，或者在 policy 里明确写上 mailDelivery: "console"。同样的组合在生产环境会直接拒绝启动，所以看到它说明这是开发或测试环境。',
      items: [],
    });
  }

  // The rules are code and the addresses are data, so this is where the two
  // fall out of step: a new intake whose address format nobody added a rule
  // for lands here, silently in no cohort, entered in no contest.
  //
  // The same pass the console's enrolment page runs, which is what keeps the
  // handles listed here and the number shown there from being two answers.
  const { untagged } = tallyCohorts(
    accountRows.filter((row) => row.status === "active"),
  );

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
        "拉模型下这把密钥是评测机进来的凭证：拿到它就能领走该后端队列里的任意提交、读到里面所有人的代码、写任意评测结果。几台共用一把，等于其中任何一台被攻破，另外几台的队列也一起丢。为每台服务设置各自的 FOI_BACKEND_<名字>_SECRET 并同步到后端本身；确实由同一套评测机服务的多个条目，填相同的值即可。生产环境会因为这一条直接拒绝启动，所以看到它说明这是开发或测试环境。",
      items: sharingSecret,
    });
  }

  // Not fatal here for the same reason the loopback finding is not: on `dev` a
  // missing address falls back to the local mock, which is what a checkout
  // looks like. On prod the boot check has already refused, so this can only
  // appear where it is survivable.
  const missingActionUrl = backendsMissingActionUrl();
  if (missingActionUrl.length > 0) {
    findings.push({
      severity: "warn",
      title: "有题目声明了交互动作，但后端没有地址",
      detail:
        "评测本身不需要后端地址——评测机自己来平台领活。但题目声明的交互动作是平台代选手同步发起的，拉不了，所以承载它们的后端仍然必须可达。缺地址时这些动作会直接失败，选手看到的是一个点不动的按钮。",
      items: missingActionUrl,
    });
  }

  // Only in a deployment. Every backend is the local mock during `pnpm dev`,
  // and a finding that stands on every developer's console is one nobody reads
  // by the time it appears on a real one — the same reason the shared-key
  // warning above counts services rather than entries.
  //
  // What this catches is the half `assertEnv` cannot. It can insist the
  // address variable was set; it cannot tell an address apart from a leftover,
  // and the leftover this deployment shape produces is `localhost`, which
  // inside the app container is the app container.
  //
  // Staging counts as a deployment here even though it is not `prod`: a copied
  // `localhost` breaks a spawn button there exactly as it does on the real one,
  // and staging exists to find that before prod does.
  const loopback = tier() === "dev" ? [] : backendsOnLoopback();

  if (loopback.length > 0) {
    findings.push({
      severity: "warn",
      title: "有题目后端的地址指向本机",
      detail:
        "容器里的 localhost 就是这个应用自己，那里没有题目后端在听。这个地址只用于题目声明的交互动作，所以受影响的是那几道题的按钮，而不是评测——多半是 .env.example 的开发用地址被抄进了部署。改成后端真正的地址（宿主机上的用 host.docker.internal，同网络的容器用容器名）；后端确实与应用共处一台机器时，可以忽略这一条。",
      items: loopback,
    });
  }

  // The one failure with no other outward sign. If the reaper stops, a runner
  // that dies takes its jobs with it — they sit in `judging` for good — while
  // pages render, submissions are accepted, and the database is reachable, so
  // every other check stays green.
  //
  // This answers for *this* process, which is the right scope while the loop
  // runs inside it; see `reaperRanAt`.
  const reaper = reaperHealth();
  if (!reaper.ok) {
    findings.push({
      severity: "warn",
      title: "回收循环似乎已经停摆",
      detail:
        "reaper 负责把失联评测机手上的提交收回来重新排队，也负责判定 attempts 用尽与排队超时。它停下之后，评测机一崩，它当时领走的提交就永远停在评测中——而页面、提交、数据库都照常，所以别的检查全是绿的。先看应用日志里有没有「回收失败」，再确认进程没有卡在某个没有超时的调用上。",
      items: [
        reaper.ranAt
          ? `最后一次回收：${reaper.ranAt.toISOString()}`
          : "本进程还没有跑过一轮",
      ],
    });
  }

  // The cheapest stand-in for the internal-error console this deliberately does
  // not have. One disrupted submission is visible on its own row and an
  // administrator can rejudge it; what nothing else would show is a runner
  // failing everything it touches, which looks exactly like a quiet afternoon
  // until somebody complains.
  const disrupted = await recentDisruptions(DISRUPTION_WINDOW_MS);
  if (disrupted > 0) {
    findings.push({
      severity: "warn",
      title: "最近有提交因为评测中断而没有结果",
      detail:
        "disrupted 表示这次评测没有产出结论，且不算在选手头上——可能是评测机自己报了 failed，也可能是它失联后被判定不会再回来。零星几条正常，成片出现说明某台评测机在持续失败。逐条打开看 error 里的原因，修好之后可以重判。",
      items: [`最近一小时 ${disrupted} 条`],
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
        "它们不会出现在选手的 /judges 页面（那里只列出承载了可见题目的题目后端）。确认是备用节点还是 content/backends.ts 里的残留。",
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
