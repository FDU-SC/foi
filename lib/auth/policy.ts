/**
 * Every distinct authorisation decision this codebase knows how to make.
 *
 * The kernel owns this list and nothing else about authorisation. These are
 * identifiers the code reads — `viewer.can("backend.inspect")` — so they cannot
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
 *
 * Where each of these actually gets asked is `./enforcement`, which is a map
 * rather than a mechanism — nothing reads it at runtime. Adding a capability
 * here without wiring it to anything fails the test beside it, because a word
 * in this list that nothing enforces reads as a control and is not one.
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
   * Named separately from `submission.readAny` because the question an operator
   * asks is "who sees through the freeze", and an answer they have to derive is
   * an answer they will get wrong under pressure. It is also *implied* by it —
   * see `IMPLIES` below, which is where that stopped being a remark in a
   * comment and became something the code does.
   */
  "standings.viewFrozen",

  /** Read submissions belonging to other people. */
  "submission.readAny",

  /** See problem backend addresses and unredacted queue entries. */
  "backend.inspect",

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
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Capabilities that another capability already gives you in practice.
 *
 * `submission.readAny` is the case that forced this. Somebody who can open
 * every submission in a contest can add them up, so withholding
 * `standings.viewFrozen` from them withholds nothing — it only makes the board
 * disagree with the data they can already reach, which is worse than either
 * answer alone. Declaring it as a grant of both was the intent all along; the
 * comment above `standings.viewFrozen` said so while `capabilitiesOf` did a
 * plain union, so a deployment that split the two got a freeze it believed in
 * and a hole it did not know about.
 *
 * Kept here rather than in `content/` for the same reason the capability list
 * is: which decisions exist, and which of them are the same decision wearing
 * two names, is the kernel's to know. Which groups hold them is not.
 *
 * Deliberately not transitive. One hop is enough for every entry there is, and
 * a fixpoint over a table this small would be machinery guarding against a
 * problem nobody has — `capabilitiesOf` asserts the flatness instead.
 */
export const IMPLIES: Partial<Record<Capability, readonly Capability[]>> = {
  "submission.readAny": ["standings.viewFrozen"],
};

/** Shown wherever a capability is displayed to an operator. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  "admin.access": "进入运维台",
  "problem.viewAll": "查看全部题目",
  "contest.viewAll": "查看全部比赛",
  "standings.viewFrozen": "封榜期间查看真实排名",
  "submission.readAny": "查看他人提交",
  "backend.inspect": "查看题目后端细节",
  "account.read": "查看账号目录与邮箱",
  "credential.manage": "代发找回密码邮件",
  "account.moderate": "封禁与解封账号",
};

export function isCapability(value: unknown): value is Capability {
  return (
    typeof value === "string" &&
    (CAPABILITIES as readonly string[]).includes(value)
  );
}
