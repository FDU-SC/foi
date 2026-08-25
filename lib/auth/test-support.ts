import { viewerFor, type Viewer } from "./viewer";

/**
 * Viewers the access suites need and production does not.
 *
 * Kept out of `./viewer` for the same reason `lib/standings/test-support.ts`
 * is kept out of the ruleset modules: a fixture exported from the module it
 * exercises reads like part of that module's interface, and this one did.
 */

/**
 * A viewer in no group at all — the baseline the gates are measured against,
 * and the one viewer whose answers cannot move when `content/enrollment/`
 * does.
 *
 * This used to be exported from `./viewer`, beside `viewerFor`, on the
 * argument that some decisions must not bend for anybody: an administrator
 * proofreading an unopened problem should be able to read it, and should still
 * not be able to queue work on its judges, so the submission path should ask
 * with no groups rather than with theirs.
 *
 * Both of the gates that argument names refuse to take it, and say why in
 * their own comments. A problem given to 校队 has no audience under a viewer
 * with no groups, so asking that way refuses the very members it was written
 * for — it collapses "may this person have it" into "may anybody have it",
 * which is a blunter question with a different answer. `submitFor` and
 * `actionFor` resolve the asker's own viewer and put `open` on top of it
 * instead, which turns the proofreader away without turning anybody else away
 * with them.
 *
 * So the constant sat in the kernel arguing for a design the only two call
 * sites it named had already answered, and every reference to it outside that
 * argument was a test. It is a fixture, and this is where fixtures live. What
 * it is good for is unchanged: it is how a suite asks what an ordinary visitor
 * can reach, which is the floor every capability is measured above.
 *
 * Built through `viewerFor` rather than as an object literal, so that exactly
 * one thing in the repository still knows how a `Viewer` answers. Spelling the
 * three fields out here would put a second one in a test-support file, which
 * is the last place anybody would think to look for it.
 */
export const AS_PLAYER: Viewer = viewerFor(null);
