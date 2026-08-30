/**
 * The fixture's group ids, in one place because policies, enrollment, problems
 * and contests all have to agree on them.
 *
 * Kernel tests never name these. They ask `test/content-shapes.ts` for "a group
 * that may do X", which is the contract a deployment actually has to satisfy.
 */

/** Granted every action the kernel tests reach for. */
export const FULL = "夹具-全权组";

/**
 * Lets the console open but withholds the account directory — the fixture
 * behind `viewerAllowedOnly`, which proves the gates compose rather than
 * collapsing into one privilege bit.
 */
export const CONSOLE = "夹具-控制台组";

/** Audience for a restricted problem. Carries no privilege. */
export const AUDIENCE = "夹具-受众组";

/** Entry list for the fixture contest. Carries no privilege. */
export const ENTRANTS = "夹具-参赛组";
