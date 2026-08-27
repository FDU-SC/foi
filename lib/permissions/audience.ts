import { z } from "zod";
import type { Viewer } from "./viewer";

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

export function audienceCovers(wider: Audience, narrower: Audience): boolean {
  if (wider === undefined) return true;
  if (narrower === undefined) return false;
  return narrower.every((group) => wider.includes(group));
}
