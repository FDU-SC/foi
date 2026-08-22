import type { ComponentType } from "react";
import { problemConfigModules, problemStatementModules } from "@/content";
import { problemConfigSchema, type ProblemConfig } from "./types";

/**
 * Problems are discovered from the filesystem at build time. Adding a problem
 * means creating a directory under `content/problems/` — no registration step,
 * and Turbopack's watcher picks up additions and removals during `next dev`.
 *
 * The globs themselves live in `content/index.ts` because Turbopack only scans
 * downward from the calling file. Configs load eagerly since listing pages
 * need all of them; statements load lazily so a problem page pulls in only the
 * MDX it is about to render.
 */
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

    // Keeping the two in sync means a slug is always derivable from the URL
    // and from the directory, with no lookup table in between.
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

export function listProblems(options?: {
  includeHidden?: boolean;
}): ProblemConfig[] {
  return [...registry.values()]
    .filter((problem) => options?.includeHidden || !problem.hidden)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "zh"));
}

export function getProblem(slug: string): ProblemConfig | undefined {
  return registry.get(slug);
}

export function hasProblem(slug: string): boolean {
  return registry.has(slug);
}

/** Loads a problem's compiled MDX statement component. */
export async function loadStatement(
  slug: string,
): Promise<ComponentType | null> {
  const load = statementLoaders.get(slug);
  if (!load) return null;
  const mod = (await load()) as { default?: ComponentType };
  return mod.default ?? null;
}
