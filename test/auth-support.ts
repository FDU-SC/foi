import { viewerFor, type Viewer } from "@/lib/auth/viewer";

/**
 * Viewers the access suites need and production does not.
 *
 * Kept out of `lib/auth/viewer.ts` for the same reason `./standings-support`
 * is kept out of the ruleset modules: a fixture exported from the module it
 * exercises reads like part of that module's interface, and this one did.
 */

/**
 * A viewer in no group at all — the baseline the gates are measured against,
 * and the one viewer whose answers cannot move when `content/enrollment/`
 * does.
 *
 * A fixture, not a production tool, and the tempting production use is the one
 * to refuse: asking the submission path with no groups so that an
 * administrator proofreading an unopened problem cannot queue work on its
 * judges. A problem given to 校队 has no audience under a viewer with no
 * groups, so asking that way refuses the very members it was written for — it
 * collapses "may this person have it" into "may anybody have it", which is a
 * blunter question with a different answer. `submitFor` and `actionFor`
 * resolve the asker's own viewer and put `open` on top of it instead, which
 * turns the proofreader away without turning anybody else away with them.
 *
 * What it is good for here is asking what an ordinary visitor can reach, which
 * is the floor every capability is measured above.
 *
 * Built through `viewerFor` rather than as an object literal, so that exactly
 * one thing in the repository still knows how a `Viewer` answers. Spelling the
 * three fields out here would put a second one in a test-support file, which
 * is the last place anybody would think to look for it.
 */
export const AS_PLAYER: Viewer = viewerFor(null);
