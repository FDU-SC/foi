import type { ProblemViews } from "@/lib/problems/views";

const viewModules = import.meta.glob("../problems/*/views.tsx", {
  eager: true,
});

export const problemViews: Record<string, ProblemViews> = {};

for (const [path, mod] of Object.entries(viewModules)) {
  const slug = path.match(/\.\.\/problems\/([^/]+)\/views\.tsx$/)?.[1];
  const views = (mod as { views?: ProblemViews }).views;
  if (slug && views) { // silently skips if views.tsx exists but doesn't export `views`
    problemViews[slug] = views;
  }
}
