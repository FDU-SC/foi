import { z } from "zod";
import type { Viewer } from "./viewer";

/**
 * Which groups a resource is for.
 *
 * The ordinary way to restrict something: a round for the school team says so
 * in the file that describes the round, next to its schedule and its problem
 * set, rather than in a permission table somewhere else. Both problems and
 * contests carry one, and they mean the same thing in both places — which is
 * why the rule lives here rather than being written twice.
 *
 * Three states, and the difference between the last two matters:
 *
 *   omitted   everyone. The default, because most things are public.
 *   ["校队"]  members of any listed group.
 *   []        nobody. What a staged-but-unreleased problem or contest looks
 *             like; it replaced the `hidden` and `visible` booleans, which
 *             were the same idea with less reach.
 *
 * A capability can override this — see `CAPABILITIES` — but nothing else can.
 * In particular a contest's `participants` does not: who competes and who may
 * look are different questions, and a public round with a closed entry list is
 * an ordinary thing to want.
 */
export const audienceSchema = z.array(z.string().min(1)).optional();

export type Audience = z.infer<typeof audienceSchema>;

/** Whether `viewer` is in the audience, ignoring any override they may hold. */
export function inAudience(audience: Audience, viewer: Viewer): boolean {
  if (audience === undefined) return true;
  return audience.some((group) => viewer.groups.includes(group));
}

/** Human-readable, for the operations console. */
export function describeAudience(audience: Audience): string {
  if (audience === undefined) return "所有人";
  if (audience.length === 0) return "无人（暂存）";
  return audience.join("、");
}

/**
 * Whether everyone `narrower` reaches is also reached by `wider`.
 *
 * `undefined` is the universe: it covers everything, and only it covers the
 * universe. Used to require that a contest never reaches further than the
 * problems it is made of — without that, a round announced to everyone could
 * carry a problem only one group may open, and the contest page would hand out
 * that problem's title and link to people the problem itself answers 404 to.
 *
 * Enforcing it at load beats filtering at render. Dropping a column from a
 * standings table leaves totals that do not add up to the columns beside them,
 * which reads as arithmetic gone wrong rather than as a problem somebody may
 * not see.
 */
export function audienceCovers(wider: Audience, narrower: Audience): boolean {
  if (wider === undefined) return true;
  if (narrower === undefined) return false;
  return narrower.every((group) => wider.includes(group));
}
