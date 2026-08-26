import { backendModules } from "@/content/backend-modules";
import { loadSingletonModule, requiredExport } from "@/lib/singleton-module";
import { INLINE_BACKEND_ID, type ProblemBackend } from "./types";

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
  const found = loadSingletonModule(backendModules, "题目后端");
  if (!found) return { backends: {}, source: null };

  const path = found.path;
  const exported = requiredExport(
    found,
    "backends",
    "见 lib/backend/types.ts 的 ProblemBackend",
  );

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

    // The one name the kernel has already spent. `submissions.backendId` is
    // `not null`, so an inline judgement is recorded under this sentinel, and
    // a declared backend sharing it would make the two indistinguishable: the
    // queue board would count settled inline rows as work waiting for a
    // runner, and a runner signing as `inline` would be handed rows it must
    // never see. Refused rather than documented: "nobody would set
    // `FOI_BACKEND_INLINE_SECRET`" is a habit, not a rule.
    if (id === INLINE_BACKEND_ID) {
      throw new Error(
        `${path} 声明了名为 "${INLINE_BACKEND_ID}" 的后端，这个名字被内核占用了：` +
          `内联判题的提交就记在这个 backendId 下。换一个名字。`,
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
