/**
 * Every distinct authorisation decision this codebase knows how to make.
 *
 * The kernel owns this list and nothing else about authorisation. These are
 * identifiers the code reads — `viewer.can("judge.inspect")` — so they cannot
 * be content; which groups exist and which of these each one holds is content,
 * and lives in `content/enrollment/`. See `./groups`.
 *
 * Permission comes from two places that compose. A problem or a contest names
 * the groups it is *for*, in its own definition file, which is the ordinary
 * case: a round for the school team says so where the round is described. The
 * capabilities below are the other axis — blanket overrides that do not belong
 * to any one resource, so they are declared once against a group instead of
 * repeated on every problem it should reach.
 *
 * Keep these coarse. A capability should describe a thing a person does, not
 * an endpoint they hit, so that adding a second route for the same activity
 * does not require a new entry.
 */
export const CAPABILITIES = [
  /** Reach the /admin operations console at all. */
  "admin.access",

  /**
   * See every problem: ones no group has been given, and ones whose contest
   * has not started.
   *
   * Proofreading a round before it opens is its own activity, so it is its own
   * capability rather than a second meaning for `admin.access`: setters need
   * it, and it says nothing about whether they may also reset a password.
   */
  "problem.viewAll",

  /** See every contest, including ones no group has been given. */
  "contest.viewAll",

  /**
   * See the real standings while a contest is frozen.
   *
   * Implied in practice by `submission.readAny` — somebody who can open every
   * submission can already add them up — but named separately because the
   * question an operator asks is "who sees through the freeze", and an answer
   * they have to derive is an answer they will get wrong under pressure.
   */
  "standings.viewFrozen",

  /** Read submissions belonging to other people. */
  "submission.readAny",

  /** See judge addresses and unredacted queue entries. */
  "judge.inspect",

  /**
   * Read the account directory, including the email addresses in it.
   *
   * Separate from `admin.access` because it is the one place the console shows
   * personal data rather than platform state.
   */
  "account.read",

  /** Send somebody a password reset they did not request. */
  "credential.manage",

  /**
   * Suspend and reinstate accounts.
   *
   * Separate from `credential.manage` because they answer different questions:
   * one is "help this person get back in", the other is "keep this person
   * out". Handing over the first should not imply the second.
   */
  "account.moderate",

  /** Push the filesystem registries into their mirror tables by hand. */
  "registry.sync",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Shown wherever a capability is displayed to an operator. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  "admin.access": "进入运维台",
  "problem.viewAll": "查看全部题目",
  "contest.viewAll": "查看全部比赛",
  "standings.viewFrozen": "封榜期间查看真实排名",
  "submission.readAny": "查看他人提交",
  "judge.inspect": "查看判题机细节",
  "account.read": "查看账号目录与邮箱",
  "credential.manage": "代发找回密码邮件",
  "account.moderate": "封禁与解封账号",
  "registry.sync": "手动同步注册表",
};

export function isCapability(value: unknown): value is Capability {
  return (
    typeof value === "string" &&
    (CAPABILITIES as readonly string[]).includes(value)
  );
}
