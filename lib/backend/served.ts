import { libraryGeneration } from "@/lib/problems/library";
import { externallyJudged } from "@/lib/problems/registry";

/**
 * The reverse index from a backend to the problems it judges.
 *
 * Kept apart from `access.ts` so the policy engine can read it while deciding
 * whether someone may know a backend exists. Inline judges never appear here —
 * they run in-process and have no backend to expose.
 *
 * Rebuilt when the set of authored problems changes, for the same reason the
 * (contest, problem) index is: an authored problem is loaded at runtime and a
 * backend it routes to must not go on looking unused.
 */

interface BackendIndex {
  generation: number;
  byBackend: Map<string, string[]>;
}

let cached: BackendIndex | null = null;

function index(): BackendIndex {
  const generation = libraryGeneration();
  if (cached?.generation === generation) return cached;

  const byBackend = new Map<string, string[]>();
  for (const problem of externallyJudged()) {
    const slugs = byBackend.get(problem.backend.id);
    if (slugs) slugs.push(problem.slug);
    else byBackend.set(problem.backend.id, [problem.slug]);
  }

  return (cached = { generation, byBackend });
}

export function problemsServedBy(backendId: string): string[] {
  return index().byBackend.get(backendId) ?? [];
}

export function servingBackendIds(): string[] {
  return [...index().byBackend.keys()];
}
