import type { ComponentType } from "react";
import { problemViews } from "@/content/problem-view-modules";
import type { Verdict } from "@/lib/backend/types";

export interface ProblemViews {

  PayloadView?: ComponentType<{ payload: unknown }>;

  VerdictDetail?: ComponentType<{ verdict: Verdict }>;
}

const registry = new Map<string, ProblemViews>(
  Object.entries(problemViews),
);

export function viewsFor(slug: string): ProblemViews {
  return registry.get(slug) ?? {};
}
