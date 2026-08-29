import { externallyJudged } from "@/lib/problems/registry";

/**
 * The reverse index from a backend to the problems it judges.
 *
 * Kept apart from `access.ts` so the policy engine can read it while deciding
 * whether someone may know a backend exists. Inline judges never appear here —
 * they run in-process and have no backend to expose.
 */

function buildIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const problem of externallyJudged()) {
    const slugs = index.get(problem.backend.id);
    if (slugs) slugs.push(problem.slug);
    else index.set(problem.backend.id, [problem.slug]);
  }

  return index;
}

const problemsByBackend = buildIndex();

export function problemsServedBy(backendId: string): string[] {
  return problemsByBackend.get(backendId) ?? [];
}

export function servingBackendIds(): string[] {
  return [...problemsByBackend.keys()];
}
