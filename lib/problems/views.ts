import type { ComponentType } from "react";
import { problemViews } from "@/content/_modules/problem-views";
import type { VerdictPreset } from "@/lib/presentation";
import type { PublicProblemConfig } from "@/lib/problems/types";

export interface ProblemViews {

  PayloadView?: ComponentType<{ payload: unknown }>;

  VerdictDetail?: ComponentType<{ detail: unknown }>;

  verdicts?: Record<string, VerdictPreset>;

  Badges?: ComponentType<{ config: PublicProblemConfig }>;
}

const registry = new Map<string, ProblemViews>(
  Object.entries(problemViews),
);

export function viewsFor(slug: string): ProblemViews {
  return registry.get(slug) ?? {};
}
