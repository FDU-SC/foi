import { backendModules } from "@/content/backend-modules";
import { loadSingletonModule, requiredExport } from "@/lib/singleton-module";
import { SLUG_PATTERN } from "@/lib/utils";
import { INLINE_BACKEND_ID, type ProblemBackend } from "./types";

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

  for (const id of Object.keys(exported)) {
    if (!SLUG_PATTERN.test(id)) {
      throw new Error(
        `${path} 里的后端 id "${id}" 只能包含小写字母、数字和连字符：` +
          `这个名字会拼进 FOI_BACKEND_<名字>_SECRET`,
      );
    }

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

export const backends: Record<string, ProblemBackend> = registry.backends;

export const backendSource: string | null = registry.source;

export function listBackendIds(): string[] {
  return Object.keys(backends);
}
