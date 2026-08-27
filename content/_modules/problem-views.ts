import { problemViewModules } from "../_view-globs";
import type { ProblemViews } from "@/lib/problems/views";

export const problemViews: Record<string, ProblemViews> = {};

for (const [path, mod] of Object.entries(problemViewModules)) {
  const slug = path.match(/problems\/([^/]+)\/views\.tsx$/)?.[1];
  const views = (mod as { views?: ProblemViews }).views;
  if (slug && views) { // silently skips if views.tsx exists but doesn't export `views`
    problemViews[slug] = views;
  }
}
