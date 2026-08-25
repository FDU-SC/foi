import { presentationModules } from "@/content/presentation-modules";
import type { Presentation } from "./types";

/**
 * What this deployment renders site-wide, or nothing.
 *
 * Both slots are optional, so an empty registry is a legal deployment: every
 * statement falls back to the elements `mdx-components.tsx` styles, and every
 * verdict status renders as its own string. Per-problem rendering is not here
 * — see `lib/problems/views.ts`.
 */
function buildRegistry(): Presentation {
  const paths = Object.keys(presentationModules).sort();
  if (paths.length === 0) return {};

  // The glob matches one path by construction, so a second would mean somebody
  // widened it without deciding which file wins.
  if (paths.length > 1) {
    throw new Error(`题面组件只能声明一处，却找到了 ${paths.join("、")}`);
  }

  const path = paths[0]!;
  const exported = (presentationModules[path] as { presentation?: unknown })
    .presentation;

  if (exported === undefined) {
    throw new Error(
      `${path} 必须导出名为 presentation 的常量，见 lib/presentation/types.ts`,
    );
  }
  if (typeof exported !== "object" || exported === null) {
    throw new Error(`${path} 导出的 presentation 必须是一个对象`);
  }

  return exported as Presentation;
}

export const presentation: Presentation = buildRegistry();
