import type { Capability } from "@/lib/permissions/policy";

/**
 * Every place this application decides whether somebody may have something.
 *
 * Three separate things in this codebase get called "permission".
 * `lib/permissions/policy.ts` is the *vocabulary* — which decisions exist.
 * `content/enrollment/` plus each resource's own `visibleTo` / `participants`
 * are the *grants* — who holds what. This file is the third: *enforcement*,
 * meaning where the question actually gets asked.
 *
 * Enforcement is deliberately spread out. It sits at the point of retrieval,
 * one gate per resource, because a rule you have to remember at each call site
 * is a rule that gets missed on the seventh page — `lib/problems/access.ts`
 * tells that story and `lib/submissions/access.ts` tells the one where it had
 * already happened. Nothing here is trying to gather that back up. This is
 * only the index, so that answering "may this person do X" does not mean
 * opening six files and hoping there is not a seventh.
 *
 * **This table is not consulted at runtime, and that is the difference between
 * it and `lib/ratelimit/policy.ts`.** That table is load-bearing — a handler
 * reads its number out of it, which is what stops the number drifting. Doing
 * the same here would make every gate read
 * `viewer.can(READ_GATES["…"].capabilities[0])` in place of
 * `viewer.can("account.read")`, and `lib/permissions/viewer.ts` is explicit that
 * every question about permission is spelled `viewer.can("…")`. A layer of
 * indirection over a string literal buys nothing and costs the one spelling.
 * So this is documentation, and `enforcement.test.ts` keeps it honest:
 * it walks the source, and fails when a gate exists that this file has not
 * heard of, or a capability exists that nothing here claims.
 *
 * **Keyed by the function that decides, not by the file it lives in.** The
 * convention is `lib/<resource>/access.ts` and it holds for six of them, but
 * two gates are genuinely elsewhere and neither is misplaced:
 * `lib/standings/compute.ts#standingsFor` and
 * `lib/backend/board.ts#judgeQueuesFor`. In both, the capability is an
 * argument to how the answer is *built* rather than a filter over an answer
 * that already exists — there is no unfrozen board waiting to be withheld,
 * because the freeze picks which board gets computed. A separate `access.ts`
 * in front of either would be a module whose whole body forwards one boolean.
 * Keying on the filename would have declared those two exceptions; keying on
 * the signature means there are none.
 *
 * `inAudience` in `lib/permissions/audience.ts` is not here either, for the opposite
 * reason: it is the shared primitive the audience column below is written in,
 * not a gate. `lib/permissions/` is the vocabulary and the viewer, it reaches no
 * database at all, and so it owns no resource and can hold no gate. That is
 * why the scan skips it.
 *
 * **The load-time checks over `content/` cannot see the capability axis, and
 * that is a boundary of the approach rather than a gap somebody left.**
 *
 * A resource declares who it is for, and the registries prove things about
 * those declarations while the repository loads. `lib/contests/registry.ts`
 * refuses a contest whose `visibleTo` reaches past any of its problems', so a
 * round cannot print a title and a score column for a statement the reader
 * gets a 404 from. That proof is real, and its scope is exactly one axis: the
 * audiences the resources named about themselves. A file being loaded has no
 * viewer, so nothing at load time can quantify over the people whose reach
 * comes from a capability instead — those are granted per group in
 * `content/enrollment/` and applied at retrieval, by the gates below.
 *
 * So every guarantee those checks give carries an unwritten qualifier: *for a
 * viewer whose only key is the audience they are in*. `audienceCovers` says
 * nothing whatsoever about a `contest.viewAll` holder, because that person
 * reaches the round by a route the round's own file never mentions.
 *
 * Teaching the loader about capabilities is not the repair, and not because it
 * would be laborious. The statement it would have to prove ranges over group
 * memberships, which are data — the answer could change without any file
 * changing, so it is not a property of the repository and a load-time check is
 * the wrong instrument for it.
 *
 * The repair is at the gate, which is the one place both axes are in scope at
 * once, and `problemFor` below is the worked example: the single state this
 * boundary could produce — somebody holding `contest.viewAll` but not
 * `problem.viewAll`, reaching a started round they are not the audience for —
 * is closed by a second override path on the accessor, not by a stricter
 * loader.
 *
 * Which leaves this table as the place the capability axis is legible and the
 * registries as the place the audience axis is. Read either one alone and you
 * will believe something about the other that is not true.
 */

/**
 * Which grant decides for everybody the capability does not cover.
 *
 * The two axes are deliberate and are not being merged: capabilities are
 * blanket overrides declared once against a group in `content/enrollment/`,
 * and audiences are per-resource and declared where the resource is. Folding
 * them together would mean adding a contest touches two files that have to
 * agree, which is the drift this split exists to avoid.
 */
export type Grant =
  /** The problem's own `visibleTo`. */
  | "problem.visibleTo"
  /** The contest's own `visibleTo` — who may read about the round. */
  | "contest.visibleTo"
  /** The contest's own `participants` — who may compete in it. */
  | "contest.participants"
  /** The row's `handle`. Yours or it is not, and no grant changes that. */
  | "owner"
  /**
   * Inherited from the problems this hangs off, never declared on its own. A
   * backend is visible when a problem it serves is; having backends name their
   * own audience would be a second place to keep in step.
   */
  | "served-problems"
  /** Time, not people: a contest's phase against the clock. */
  | "contest-phase"
  /** Nothing but the capability opens this. */
  | "capability-only";

/** What a refusal looks like to whoever called. */
export type Denied =
  /** `undefined`, indistinguishable from "no such thing". */
  | "undefined"
  /** `null`, which the console pages turn into `notFound()`. */
  | "null"
  /** `[]`. */
  | "empty-array"
  /** A zero-valued object of the same shape, so there is no partial state. */
  | "empty-object"
  /** A list gate: the refusal is that the entry is simply not in the list. */
  | "filtered-out"
  /** A predicate: `false`. */
  | "false"
  /** A tagged value naming which refusal it was, because each is a different answer. */
  | "tagged-reason"
  /** The value comes back with fields blanked rather than withheld whole. */
  | "redacted"
  /**
   * Not a withholding at all. The same type comes back, computed the way it is
   * for everybody, because the capability picks between two complete answers
   * rather than adding to one — so there is no version of the call that fails
   * on account of who is asking, and a caller who wrote a refusal branch for
   * this would have written one that never runs.
   */
  | "public-variant"
  /** Throws. Server Actions want a refusal, not a branch. */
  | "throws";

export interface Gate {
  /** The activity, phrased the way somebody would ask about it. */
  what: string;
  /**
   * Capabilities that change this gate's answer, in `lib/permissions/policy.ts`'s
   * spelling.
   *
   * Empty is a legitimate and interesting answer, and `noOverride` is then
   * required: several gates are ones no capability opens, which is a fact
   * about the system worth being able to read off a table rather than a blank
   * cell.
   */
  capabilities: readonly Capability[];
  /** Why nothing overrides this gate. Required exactly when `capabilities` is empty. */
  noOverride?: string;
  /** Which grants decide for everybody the capabilities do not cover. */
  grants: readonly Grant[];
  /**
   * What a caller gets on refusal — the column to read before writing the line
   * after the call, and the one the type system cannot tell you from the other
   * side of an `await`.
   */
  denied: Denied;
}

/**
 * Gates that hand back a resource, keyed `<path>#<function>`.
 *
 * Every exported function under `lib/` that takes a `Viewer` or a
 * `ResolvedUser` is one of these and has to appear here — that is the scan in
 * `enforcement.test.ts`, and it is what makes adding an access layer without
 * saying what it guards an error rather than an omission.
 */
export const READ_GATES = {
  // ── 题目 ────────────────────────────────────────────────────────────────
  /**
   * The audience-and-clock half on its own, without the override the two
   * accessors below apply. Worth reading as a warning: `visible: false` here
   * does *not* mean the viewer may not have the problem.
   */
  "lib/problems/access.ts#problemVisibility": {
    what: "一道题对某人是否可见，以及不可见的原因",
    capabilities: [],
    noOverride:
      "只答受众与禁运两问；`problem.viewAll` 由下面两个取函数在它之上应用，" +
      "经由比赛的那条越权只由 `problemFor` 应用",
    grants: ["problem.visibleTo", "contest-phase"],
    denied: "tagged-reason",
  },
  /**
   * One capability, where the accessor below has two, and the asymmetry is the
   * point rather than an oversight.
   *
   * Both share `viewOf`, so both compute the contest override and both carry
   * it on `reachedVia`. It changes nothing here: a problem reached only
   * because its round can be seen still has `gate.visible: false`, so it is
   * not `open`, and the filter is `override || entry.open` where `override` is
   * `problem.viewAll` alone. The list a `contest.viewAll` holder gets is the
   * one they got before.
   *
   * Which is deliberate, and not a rounding error worth papering over with a
   * matching row: such a problem is readable at its own URL and stays out of
   * the catalogue, because listing it would put a problem in somebody's 题库
   * that they cannot submit to and were never given. Recording the capability
   * here would say this gate's answer moves when it does not — `capabilities`
   * means exactly that and nothing looser — and a reader looking for the
   * design decision would find two identical rows instead of it.
   */
  "lib/problems/access.ts#problemsFor": {
    what: "列出这个人能看到的题目",
    capabilities: ["problem.viewAll"],
    grants: ["problem.visibleTo", "contest-phase"],
    denied: "filtered-out",
  },
  /**
   * Retirement is not part of this gate. A retired problem stays readable by
   * whoever it was written for — what retirement withholds is `open`, which is
   * the field `submitFor` and `actionFor` read, not the statement.
   *
   * Two capabilities, and the second is not a weaker copy of the first.
   * `problem.viewAll` is the blanket override: every problem, gated or
   * retired, carrying its reason. `contest.viewAll` reaches a far smaller set
   * and only by transitivity — it takes somebody to a round they are not the
   * audience for, and once that round has *started*, "you can see the contest"
   * has to mean "you can see its problems" or the contest page prints a title
   * and a score column linking to a 404. The load-time check in
   * `lib/contests/registry.ts` makes that implication hold on the audience
   * axis and structurally cannot make it hold on this one; see the note at the
   * top of this file for why, and why the repair belongs at a gate instead.
   *
   * That is also why `contest.visibleTo` appears as a grant on a problem gate,
   * which looks out of place until you read the second path: it asks whether
   * there is a started contest this viewer can reach, so a contest's own
   * audience decides half the answer about a problem.
   *
   * Neither override moves `gate.visible`, so a statement reached through
   * either comes back readable and unsubmittable — the same treatment
   * `problem.viewAll` always had, now shared. Which one carried the viewer
   * past the gate is `reachedVia`, answered here so that the statement page
   * can print the right notice without asking a capability of its own.
   *
   * Deliberately not written as `IMPLIES: contest.viewAll → problem.viewAll`
   * in `lib/permissions/policy.ts`, which would be far too wide — it would hand over
   * unstarted rounds too, and that file is explicit that proofreading a round
   * before it opens is the entire reason `problem.viewAll` exists on its own.
   */
  "lib/problems/access.ts#problemFor": {
    what: "取一道题的题面",
    capabilities: ["problem.viewAll", "contest.viewAll"],
    grants: ["problem.visibleTo", "contest-phase", "contest.visibleTo"],
    denied: "undefined",
  },
  /**
   * Undefined for every refusal, so the route answers 404 to all of them. The
   * distinctions are the leak here: saying `spawn` exists on a problem you
   * cannot see confirms the problem, and saying `poll` is not declared
   * enumerates what is.
   *
   * Filed under 题目 rather than 题目后端 because that is what it decides. It
   * lived in `lib/backend/` while the directory was also holding the problem
   * gates; what it asks is whether this viewer may act on this *problem*, and
   * the backend is only where the answer gets relayed to.
   */
  "lib/problems/actions.ts#actionFor": {
    what: "这个人能不能对这道题调用某个交互动作",
    capabilities: [],
    noOverride: "同 `submitFor`：`problem.viewAll` 能读题，不能起容器",
    grants: ["problem.visibleTo", "contest-phase"],
    denied: "undefined",
  },

  // ── 比赛 ────────────────────────────────────────────────────────────────
  "lib/contests/access.ts#contestVisibility": {
    what: "一场比赛对某人是否可见，以及不可见的原因",
    capabilities: [],
    noOverride: "只答受众一问；`contest.viewAll` 由下面两个取函数在它之上应用",
    grants: ["contest.visibleTo"],
    denied: "tagged-reason",
  },
  "lib/contests/access.ts#contestsFor": {
    what: "列出这个人能看到的比赛",
    capabilities: ["contest.viewAll"],
    grants: ["contest.visibleTo"],
    denied: "filtered-out",
  },
  /**
   * Not gated on the phase, unlike a problem. An unstarted round is an
   * announcement — its title and schedule are how people know to turn up. What
   * it withholds is the problem set, which `isContestProblemSetVisibleTo`
   * answers on its own below.
   */
  "lib/contests/access.ts#contestFor": {
    what: "取一场比赛的公告页数据",
    capabilities: ["contest.viewAll"],
    grants: ["contest.visibleTo"],
    denied: "undefined",
  },
  /**
   * The second contest audience, and the one that is not about reading. Takes
   * the account rather than a `Viewer` on purpose: entry needs a handle that
   * is really somebody's, and `Viewer.handle` is allowed to be null.
   */
  "lib/contests/access.ts#canEnterContest": {
    what: "这个人有没有参赛资格",
    capabilities: [],
    noOverride:
      "没有任何能力能把人塞进闭门赛；`contest.viewAll` 尤其不能，否则「能读」就成了「能参赛」",
    grants: ["contest.participants"],
    denied: "false",
  },
  /**
   * The third contest gate, and the only one the clock decides. Here rather
   * than in `PAGE_CHECKS` because it must not be a page's to spell out: the
   * contest page and the standings page both draw a problem list, nothing
   * downstream re-checks, and the third page to draw one would copy only the
   * half of the rule it noticed.
   */
  "lib/contests/access.ts#isContestProblemSetVisibleTo": {
    what: "开赛前扣住题目集：几道题、叫什么、各值多少分",
    capabilities: ["problem.viewAll"],
    grants: ["contest-phase"],
    denied: "false",
  },
  /**
   * The only gate here assembled out of two others above it: `contestFor`
   * answers the first of its four questions and `canEnterContest` the last,
   * with "does this round contain the problem" and `isContestOpen` in between.
   *
   * Registered in its own right all the same, because the ordering is the
   * gate, and no call site may spell it out itself. A copy that drops the
   * first question hands a staged round's slug to the submit panel, for an
   * attribution the API then refuses. Four facts held together is not three
   * facts and a remark.
   *
   * `capabilities` is empty and means it. `contest.viewAll` does get somebody
   * a view out of `contestFor`, but the first question reads `gate.visible`
   * off that view rather than taking the view itself, so the reach stops
   * there — before the round has even been asked whether it contains the
   * problem.
   *
   * Refusals are tagged because `submitFor` owes its caller the difference
   * between a round that is over and a round they are not in. The other two
   * callers collapse both to null, which is a decision about what an
   * unhonourable contest slug means to them rather than about who may have
   * what, so it stays at the call site and out of this column.
   */
  "lib/contests/access.ts#contestEntryFor": {
    what: "客户端指名的这场比赛，能不能作为这次提交／交互的归属",
    capabilities: [],
    noOverride:
      "没有任何能力能把人塞进闭门赛；`contest.viewAll` 在第一问就被 `gate.visible` 挡下，" +
      "「能读」与「能参赛」正是在那一步分开的",
    grants: ["contest.visibleTo", "contest-phase", "contest.participants"],
    denied: "tagged-reason",
  },

  // ── 提交 ────────────────────────────────────────────────────────────────
  /**
   * 「这条提交是不是这个人能读的」曾经是这里的一条独立门禁
   * （`canReadSubmission`），现在是下面这个取函数里的一行：生产代码从来只有
   * `submissionFor` 调它。
   */
  "lib/submissions/access.ts#submissionFor": {
    what: "取一条提交的详情",
    capabilities: ["submission.readAny"],
    grants: ["owner"],
    denied: "undefined",
  },
  /**
   * Scope comes from the viewer and an argument can only narrow it. Asking for
   * somebody else's submissions without the capability returns your own — the
   * `handle` option is a filter, never a widening.
   */
  "lib/submissions/access.ts#submissionsFor": {
    what: "列出这个人能看到的提交",
    capabilities: ["submission.readAny"],
    grants: ["owner"],
    denied: "empty-array",
  },
  /**
   * Permission to queue work on a judge, which is a different question from
   * permission to read the statement — and answered `no` for some people who
   * may read it. Refusals are tagged rather than collapsed, because unlike
   * `actionFor` the distinctions here are safe to tell somebody: everything
   * past `no-problem` has already passed the problem gate.
   */
  "lib/submissions/gate.ts#submitFor": {
    what: "这个人能不能对这道题提交，能的话算不算这场比赛的",
    capabilities: [],
    noOverride:
      "校对未开赛题目的 `problem.viewAll` 持有者读得到题面，但不能给它的评测机排队",
    grants: ["problem.visibleTo", "contest-phase", "contest.participants"],
    denied: "tagged-reason",
  },

  // ── 题目后端 ────────────────────────────────────────────────────────────
  "lib/backend/access.ts#canSeeBackend": {
    what: "这个人该不该知道这台后端存在",
    capabilities: ["backend.inspect"],
    grants: ["served-problems"],
    denied: "false",
  },
  "lib/backend/access.ts#backendsFor": {
    what: "列出这个人能看到的题目后端",
    capabilities: ["backend.inspect"],
    grants: ["served-problems"],
    denied: "filtered-out",
  },
  /**
   * Two refusals in one call, and both matter. A backend the viewer may not
   * know about is absent entirely; one they may see comes back with its
   * address and other people's problem choices blanked, because queue depth is
   * fine to show and who is working on what mid-contest is not.
   */
  "lib/backend/board.ts#judgeQueuesFor": {
    what: "取评测队列，且只取这个人该看到的那部分",
    capabilities: ["backend.inspect"],
    grants: ["served-problems"],
    denied: "redacted",
  },

  // ── 排行榜 ──────────────────────────────────────────────────────────────
  /**
   * Not in an `access.ts`, and not misplaced — see the note at the top. The
   * capability picks which of two boards gets computed, and the two are cached
   * under different keys so that serving one where the other was asked for
   * cannot happen. Who may reach the page at all is `contestFor`'s answer,
   * asked upstream.
   *
   * The `null` in the signature is therefore not this gate refusing anybody.
   * It means no contest goes by that slug, and the capability holder gets it
   * just the same — which is why this column must not say `null`. Somebody
   * without `standings.viewFrozen` gets a whole board, so the refusal branch
   * that entry would invite never runs, while the case that does occur has
   * nothing to do with permission.
   */
  "lib/standings/compute.ts#standingsFor": {
    what: "取排行榜，封榜期间是真实的还是冻结的",
    capabilities: ["standings.viewFrozen"],
    grants: ["capability-only"],
    denied: "public-variant",
  },

  // ── 账号目录 ────────────────────────────────────────────────────────────
  /**
   * The one part of the console showing personal data rather than platform
   * state, which is why it answers to `account.read` and not to `admin.access`.
   */
  "lib/accounts/access.ts#accountDirectoryFor": {
    what: "读账号目录，含邮箱与凭据状态",
    capabilities: ["account.read"],
    grants: ["capability-only"],
    denied: "empty-object",
  },
  "lib/accounts/access.ts#accountsFor": {
    what: "读账号行，给只需要计数的页面",
    capabilities: ["account.read"],
    grants: ["capability-only"],
    denied: "empty-array",
  },

  // ── 运维台 ──────────────────────────────────────────────────────────────
  "lib/admin/access.ts#adminOverviewFor": {
    what: "读运维台首页的概览与漂移报告",
    capabilities: ["admin.access"],
    grants: ["capability-only"],
    denied: "null",
  },
  /**
   * Two capabilities, nested rather than combined. `admin.access` decides
   * whether there is a page; `account.read` decides whether the table in it
   * has anybody in it, and that half is `accountDirectoryFor`'s to answer.
   */
  "lib/admin/access.ts#adminAccountsFor": {
    what: "读运维台的账号页",
    capabilities: ["admin.access", "account.read"],
    grants: ["capability-only"],
    denied: "null",
  },
  /**
   * Deliberately the raw registry rather than `contestsFor`: the console's job
   * is to show what the repository says, including rounds staged for nobody.
   * That is what `admin.access` buys.
   */
  "lib/admin/access.ts#adminContestsFor": {
    what: "读运维台的比赛表，含对任何人都不可见的暂存轮次",
    capabilities: ["admin.access"],
    grants: ["capability-only"],
    denied: "null",
  },
  /**
   * The same split as `adminAccountsFor` and for the same reason, but visible
   * inside one return value rather than as a 404: the rules are platform state
   * and answer to `admin.access`, the hit counts are computed from addresses
   * and answer to `account.read`, so a viewer with only the first gets the
   * rules with null counts.
   */
  "lib/admin/access.ts#enrollmentViewFor": {
    what: "读分流规则，以及每条规则命中多少人",
    capabilities: ["admin.access", "account.read"],
    grants: ["capability-only"],
    denied: "null",
  },
} as const satisfies Record<string, Gate>;

/**
 * Gates that permit a change, keyed by the Server Action's exported name.
 *
 * Every action starting with `requireCapability` is here, and the capability
 * recorded is checked against the one the source actually names. Actions with
 * no capability check — `login`, `registerAction` and the rest — are not
 * authorisation decisions and are deliberately absent; what bounds *those* is
 * `lib/ratelimit/policy.ts`.
 *
 * `denied` is always `throws`, and the asymmetry with the read gates is the
 * point: a page that cannot show you something renders without it, while an
 * action you may not take has no partial version to fall back to.
 */
export const WRITE_GATES = {
  /**
   * The privileged half of password recovery. The secret never passes through
   * the operator — they trigger the mail and the link goes to the address the
   * account already proved it controls.
   */
  resendPasswordResetAction: {
    what: "代某个账号发一封找回密码邮件",
    capabilities: ["credential.manage"],
    grants: ["capability-only"],
    denied: "throws",
  },
  /**
   * Stops at the edge of the privileged groups, and that limit is not
   * expressible as a capability: the action refuses any target holding one,
   * itself included. Everything that grants power is a reviewed commit naming
   * a person, so taking it away has to be one too.
   */
  suspendAccountAction: {
    what: "封禁一个账号",
    capabilities: ["account.moderate"],
    grants: ["capability-only"],
    denied: "throws",
  },
  reinstateAccountAction: {
    what: "解封一个账号",
    capabilities: ["account.moderate"],
    grants: ["capability-only"],
    denied: "throws",
  },
  /**
   * The only way a finished submission changes after the fact, and the only
   * state transition anybody drives by hand.
   *
   * `capability-only`, with no owner grant beside it, and that asymmetry is
   * deliberate: reading a submission is yours because it is yours, but
   * rejudging your own is asking for a second roll of the dice on a problem
   * whose judging you did not like. The row's `handle` opens the statement, not
   * the queue.
   */
  rejudgeSubmissionAction: {
    what: "把一条已终结的提交放回评测队列",
    capabilities: ["submission.rejudge"],
    grants: ["capability-only"],
    denied: "throws",
  },
} as const satisfies Record<string, Gate>;

export type ReadGateKey = keyof typeof READ_GATES;
export type WriteGateKey = keyof typeof WRITE_GATES;

/**
 * Every capability check that is *not* in a gate, and what it is instead.
 *
 * This is the table that stops the map being read too generously. Grepping
 * `can("admin.access")` finds `proxy.ts` and the site header before it finds
 * anything that refuses, and somebody has to be told that neither is the
 * answer. Equally, two of these are boundaries that happen to live in a page,
 * and a map that quietly omitted them would be the more dangerous mistake.
 *
 * `enforcement.test.ts` scans every `viewer.can("…")` outside the registered
 * gates and requires the file to be here, so this stays complete rather than
 * becoming a snapshot of one afternoon.
 */
export type PageCheck =
  | {
      /**
       * Decides what gets drawn, not what may be reached. Rendering a button
       * somebody cannot use is a UX problem; the Server Action behind it does
       * its own refusing.
       */
      kind: "chrome";
      what: string;
      capabilities: readonly Capability[];
      /** What actually refuses, if the check here were deleted. */
      enforcedBy: readonly (ReadGateKey | WriteGateKey)[];
    }
  | {
      /**
       * Runs ahead of the real gate and is allowed to be wrong in the
       * permissive direction. Never the only thing between somebody and data.
       */
      kind: "optimistic";
      what: string;
      capabilities: readonly Capability[];
      why: string;
      enforcedBy: readonly (ReadGateKey | WriteGateKey)[];
    }
  | {
      /** Load-bearing. Delete it and something leaks. */
      kind: "boundary";
      what: string;
      capabilities: readonly Capability[];
      why: string;
    };

export const PAGE_CHECKS = {
  "proxy.ts": {
    kind: "optimistic",
    what: "把没登录的人从 /admin 挡回登录页",
    capabilities: ["admin.access"],
    why:
      "答案只来自 token。会话回调按仓库里的授予解析 handle，从不读 accounts 表，" +
      "所以一个已被封禁、但还攥着有效 JWT 的账号在这里仍然看起来是管理员。" +
      "换来的是每次预取都便宜——真正拒绝的是下面这四个层。",
    enforcedBy: [
      "lib/admin/access.ts#adminOverviewFor",
      "lib/admin/access.ts#adminAccountsFor",
      "lib/admin/access.ts#adminContestsFor",
      "lib/admin/access.ts#enrollmentViewFor",
    ],
  },
  "components/site/header.tsx": {
    kind: "chrome",
    what: "决定导航栏里显不显示「管理」入口",
    capabilities: ["admin.access"],
    enforcedBy: ["lib/admin/access.ts#adminOverviewFor"],
  },
  "app/(site)/admin/accounts/page.tsx": {
    kind: "chrome",
    what: "决定每一行要不要画「发送重置邮件」和「封禁」按钮",
    capabilities: ["credential.manage", "account.moderate"],
    enforcedBy: [
      "resendPasswordResetAction",
      "suspendAccountAction",
      "reinstateAccountAction",
    ],
  },
  /**
   * Not a boundary: `isContestProblemSetVisibleTo` decides whether the list
   * gets resolved at all. What is left asks the same capability for a
   * different question — the gate has already said the viewer may have the
   * problems, and this only picks which reason to print above them.
   */
  "app/(site)/contests/[slug]/page.tsx": {
    kind: "chrome",
    what: "开赛前的预览者，题目上方画不画「尚未对选手公开」的徽标",
    capabilities: ["problem.viewAll"],
    enforcedBy: ["lib/contests/access.ts#isContestProblemSetVisibleTo"],
  },
  /**
   * Chrome, and it matters that it is only chrome: the page has already been
   * opened by `submissionFor`, which lets an owner read their own row, and
   * `submission.rejudge` is a strictly narrower question than that. Whether the
   * button is worth drawing is all this decides — the action re-asks, and it is
   * the one that refuses.
   */
  "app/(site)/submissions/[id]/page.tsx": {
    kind: "chrome",
    what: "详情页上画不画「重新评测」按钮",
    capabilities: ["submission.rejudge"],
    enforcedBy: ["rejudgeSubmissionAction"],
  },
} as const satisfies Record<string, PageCheck>;
