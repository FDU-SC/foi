import { z } from "zod";
import type { Viewer } from "./viewer";

/**
 * `visibleTo` on a problem or contest. A resource attribute, not a permission:
 * policies read it, nobody is granted it.
 *
 * - omitted   — everyone
 * - `[]`      — nobody (staging)
 * - `["a"]`   — members of any listed group
 */
export const audienceSchema = z.array(z.string().min(1)).optional();

export type Audience = z.infer<typeof audienceSchema>;

export function inAudience(audience: Audience, viewer: Viewer): boolean {
  if (audience === undefined) return true;
  return audience.some((group) => viewer.groups.includes(group));
}

export function describeAudience(audience: Audience): string {
  if (audience === undefined) return "所有人";
  if (audience.length === 0) return "无人（暂存）";
  return audience.join("、");
}

/** Whether everyone in `narrower` is also in `wider`. */
export function audienceCovers(wider: Audience, narrower: Audience): boolean {
  if (wider === undefined) return true;
  if (narrower === undefined) return false;
  return narrower.every((group) => wider.includes(group));
}
