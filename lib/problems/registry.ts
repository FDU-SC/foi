import type { ComponentType } from "react";
import {
  problemConfigModules,
  problemStatementModules,
} from "@/content/problem-modules";
import { problemConfigSchema, type ProblemConfig } from "./types";

/**
 * Problems are discovered from the filesystem at build time. Adding a problem
 * means creating a directory under `content/problems/` — no registration step,
 * and Turbopack's watcher picks up additions and removals during `next dev`.
 *
 * The globs themselves live under `content/` because Turbopack only scans
 * downward from the calling file. Configs load eagerly; statements load lazily
 * from a module marked `server-only`, so their chunks remain on the server.
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

/**
 * Every problem as authored, with no view of who is asking.
 *
 * Named for what it is so that reaching for it is a decision. Anything that
 * renders to a person wants `problemsFor()` in `./access`, which answers the
 * same question for a particular viewer; the callers left here are the ones
 * that legitimately need the whole set — the mirror sync, the drift report,
 * load-time validation, and the access layer itself.
 *
 * `hidden` is deliberately not filtered here. It is one of two reasons a
 * problem may be withheld, and splitting one of them into the registry while
 * the other lives in the gate is how they drift apart.
 */
export function allProblems(): ProblemConfig[] {
  return [...registry.values()].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title, "zh"),
  );
}

/** One problem as authored. Same caveat as `allProblems`. */
export function problemBySlug(slug: string): ProblemConfig | undefined {
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
