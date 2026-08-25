import { backendModules } from "@/content/backend-modules";
import type { ProblemBackend } from "./types";

/**
 * The backends this deployment declares, discovered the same way problems and
 * rulesets are.
 *
 * A declared list rather than one derived from `problem.backend.id`, and the
 * difference is worth stating because deriving would be shorter. The list is
 * what makes an id a *whitelist*: a problem naming `tradtional` fails to
 * resolve and says so, where a derived set would quietly grow a fifth queue
 * that no runner serves and no operator has any reason to look at. It is also
 * what lets a backend exist before the first problem points at it, and what
 * keeps a queue drainable after the last problem stops.
 *
 * Empty is legal. A deployment whose problems are all judged inline needs no
 * backends at all, and one that names a backend it did not declare finds out
 * from `undeclaredBackends` at startup rather than from a 500 at submit time.
 */
function buildRegistry(): {
  backends: Record<string, ProblemBackend>;
  source: string | null;
} {
  const paths = Object.keys(backendModules).sort();
  if (paths.length === 0) return { backends: {}, source: null };

  // The glob matches one path by construction, so a second would mean somebody
  // widened it without deciding which file wins.
  if (paths.length > 1) {
    throw new Error(`题目后端只能声明一处，却找到了 ${paths.join("、")}`);
  }

  const path = paths[0]!;
  const exported = (backendModules[path] as { backends?: unknown }).backends;

  if (exported === undefined) {
    throw new Error(
      `${path} 必须导出名为 backends 的常量，见 lib/backend/types.ts 的 ProblemBackend`,
    );
  }
  if (
    typeof exported !== "object" ||
    exported === null ||
    Array.isArray(exported)
  ) {
    throw new Error(`${path} 导出的 backends 必须是一个对象，键是后端 id`);
  }

  // The keys double as environment-variable fragments, so the same spelling
  // rule a problem slug gets applies here: anything else produces a variable
  // name nobody can set.
  for (const id of Object.keys(exported)) {
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw new Error(
        `${path} 里的后端 id "${id}" 只能包含小写字母、数字和连字符：` +
          `这个名字会拼进 FOI_BACKEND_<名字>_SECRET`,
      );
    }
  }

  return {
    backends: exported as Record<string, ProblemBackend>,
    source: path,
  };
}

const registry = buildRegistry();

/**
 * Mutable on purpose, and only for tests: several of them stand a backend up
 * or take one away to exercise a boot check. Nothing in the application writes
 * to it.
 */
export const backends: Record<string, ProblemBackend> = registry.backends;

/** Where the declaration came from, or null when this deployment ships none. */
export const backendSource: string | null = registry.source;

/** Every declared backend, in declaration order. */
export function listBackendIds(): string[] {
  return Object.keys(backends);
}
