import { backends as declared } from "@/content/backend-modules";
import { SLUG_PATTERN } from "@/lib/utils";
import { INLINE_BACKEND_ID, type ProblemBackend } from "./types";

function validate(
  exported: Record<string, ProblemBackend>,
): Record<string, ProblemBackend> {
  for (const id of Object.keys(exported)) {
    if (!SLUG_PATTERN.test(id)) {
      throw new Error(
        `content/backends.ts 里的后端 id "${id}" 只能包含小写字母、数字和连字符：` +
          `这个名字会拼进 FOI_BACKEND_<名字>_SECRET`,
      );
    }

    if (id === INLINE_BACKEND_ID) {
      throw new Error(
        `content/backends.ts 声明了名为 "${INLINE_BACKEND_ID}" 的后端，这个名字被内核占用了：` +
          `内联判题的提交就记在这个 backendId 下。换一个名字。`,
      );
    }
  }

  return exported;
}

export const backends: Record<string, ProblemBackend> = validate(declared);

export function listBackendIds(): string[] {
  return Object.keys(backends);
}
