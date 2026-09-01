import type { ComponentType } from "react";
import {
  problemConfigModules,
  problemJudgeModules,
  problemStatementModules,
} from "@/content/_modules/problems";
import { slugFromGlobPath } from "@/lib/slug-from-path";
import {
  isInlineBackend,
  problemConfigSchema,
  type ExternallyJudged,
  type InlineJudge,
  type ProblemConfig,
} from "./types";

type JudgeModule = { judge?: InlineJudge; config?: unknown };

function mergeJudgeModule(raw: Record<string, unknown>, path: string): void {
  const backend = raw.backend as Record<string, unknown> | undefined;
  if (backend?.kind !== "inline" || typeof backend.judge === "function") return;

  const judgePath = path.replace(/problem\.ts$/, "judge.ts");
  const judgeMod = problemJudgeModules[judgePath] as JudgeModule | undefined;
  if (!judgeMod) return;

  if (judgeMod.judge) backend.judge = judgeMod.judge;
  if (judgeMod.config !== undefined) backend.config = judgeMod.config;
}

function buildRegistry(): Map<string, ProblemConfig> {
  const registry = new Map<string, ProblemConfig>();

  for (const [path, mod] of Object.entries(problemConfigModules)) {
    const dirSlug = slugFromGlobPath(path, "problems");
    if (!dirSlug) continue;

    const exported = (mod as { problem?: unknown }).problem;
    if (exported === undefined) {
      throw new Error(`${path} 必须导出名为 problem 的常量`);
    }

    mergeJudgeModule(exported as Record<string, unknown>, path);

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
    const slug = slugFromGlobPath(path, "problems");
    return slug ? [[slug, load] as const] : [];
  }),
);

/**
 * Every problem the deployment ships, in slug order.
 *
 * Not a catalogue: a problem is reachable only through a contest that carries
 * it, so this is the raw inventory that boot checks and backend routing read.
 */
export function allProblems(): ProblemConfig[] {
  return [...registry.values()].sort((a, b) => a.slug.localeCompare(b.slug));
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
