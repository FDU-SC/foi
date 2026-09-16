import { backends as declared } from "@/content/backends";
import { SLUG_PATTERN } from "@/lib/utils";
import { INLINE_BACKEND_ID, type ProblemBackend } from "./types";

function validate(
  exported: Record<string, ProblemBackend>,
): Record<string, ProblemBackend> {
  for (const id of Object.keys(exported)) {
    if (!SLUG_PATTERN.test(id)) {
      throw new Error(
        `后端 id "${id}" 只能包含小写字母、数字和连字符`,
      );
    }

    if (id === INLINE_BACKEND_ID) {
      throw new Error(
        `后端 id "${INLINE_BACKEND_ID}" 为内联判题保留，不可声明`,
      );
    }
  }

  return exported;
}

export const backends: Record<string, ProblemBackend> = validate(declared);

export function listBackendIds(): string[] {
  return Object.keys(backends);
}
