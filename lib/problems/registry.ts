import type { ComponentType } from "react";
import {
  problemConfigModules,
  problemStatementModules,
} from "@/content/problem-modules";
import {
  isInlineBackend,
  problemConfigSchema,
  type ExternallyJudged,
  type ProblemConfig,
} from "./types";

function slugFromPath(path: string): string | null {
  return path.match(/\/problems\/([^/]+)\/[^/]+$/)?.[1] ?? null;
}

function buildRegistry(): Map<string, ProblemConfig> {
  const registry = new Map<string, ProblemConfig>();

  for (const [path, mod] of Object.entries(problemConfigModules)) {
    const dirSlug = slugFromPath(path);
    if (!dirSlug) continue;

    const exported = (mod as { problem?: unknown }).problem;
    if (exported === undefined) {
      throw new Error(`${path} 必须导出名为 problem 的常量`);
    }

    const parsed = problemConfigSchema.safeParse(exported);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(
          (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
        )
        .join("\n");
      throw new Error(`${path} 的题目配置不合法:\n${issues}`);
    }

    if (parsed.data.slug !== dirSlug) {
      throw new Error(
        `${path} 的 slug "${parsed.data.slug}" 与目录名 "${dirSlug}" 不一致`,
      );
    }

    registry.set(dirSlug, parsed.data);
  }

  return registry;
}

const registry = buildRegistry();

const statementLoaders = new Map<string, () => Promise<unknown>>(
  Object.entries(problemStatementModules).flatMap(([path, load]) => {
    const slug = slugFromPath(path);
    return slug ? [[slug, load] as const] : [];
  }),
);

export function allProblems(): ProblemConfig[] {

  return [...registry.values()].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title),
  );
}

export function externallyJudged(): ExternallyJudged[] {
  return allProblems().filter(
    (problem): problem is ExternallyJudged => !isInlineBackend(problem.backend),
  );
}

export function problemBySlug(slug: string): ProblemConfig | undefined {
  return registry.get(slug);
}

export async function loadStatement(
  slug: string,
): Promise<ComponentType | null> {
  const load = statementLoaders.get(slug);
  if (!load) return null;
  const mod = (await load()) as { default?: ComponentType };
  return mod.default ?? null;
}
