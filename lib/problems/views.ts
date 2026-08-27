import type { ComponentType } from "react";
import {
  problemViewDefaultModules,
  problemViewModules,
} from "@/content/problem-view-modules";
import type { Verdict } from "@/lib/backend/types";
import { loadSingletonModule, requiredExport } from "@/lib/singleton-module";

export interface ProblemViews {

  PayloadView?: ComponentType<{ payload: unknown }>;

  VerdictDetail?: ComponentType<{ verdict: Verdict }>;
}

const SLUG = /\/problems\/([^/]+)\/views\.tsx$/;

function checked(source: string, exported: ProblemViews): ProblemViews {
  for (const key of ["PayloadView", "VerdictDetail"] as const) {
    const value = exported[key];
    if (value !== undefined && typeof value !== "function") {
      throw new Error(`${source} 的 ${key} 必须是一个组件`);
    }
  }

  return {
    PayloadView: exported.PayloadView,
    VerdictDetail: exported.VerdictDetail,
  };
}

function buildRegistry(): Map<string, ProblemViews> {
  const registry = new Map<string, ProblemViews>();

  const defaults = loadSingletonModule(
    problemViewDefaultModules,
    "题目渲染的默认表",
  );
  if (defaults) {
    const declared = requiredExport(
      defaults,
      "problemViews",
      "见 lib/problems/views.ts 的 ProblemViews",
    );
    if (typeof declared !== "object" || declared === null) {
      throw new Error(
        `${defaults.path} 导出的 problemViews 必须是一个以 slug 为键的对象`,
      );
    }

    for (const [slug, views] of Object.entries(
      declared as Record<string, ProblemViews>,
    )) {
      registry.set(slug, checked(`${defaults.path} 里的 ${slug}`, views));
    }
  }

  for (const [path, mod] of Object.entries(problemViewModules)) {
    const slug = path.match(SLUG)?.[1];

    if (!slug) throw new Error(`无法从 ${path} 解析出题目 slug`);

    registry.set(slug, checked(path, mod as ProblemViews));
  }

  return registry;
}

const registry = buildRegistry();

export function viewsFor(slug: string): ProblemViews {
  return registry.get(slug) ?? {};
}
