import type { Viewer } from "@/lib/permissions/viewer";
import { problemFor } from "@/lib/problems/access";
import { externallyJudged } from "@/lib/problems/registry";
import { backends } from "./registry";

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

export function orphanedBackends(): string[] {
  return Object.keys(backends).filter((id) => problemsServedBy(id).length === 0);
}

export function undeclaredBackends(): string[] {
  return [...problemsByBackend.keys()].filter((id) => !backends[id]);
}

export function canSeeBackend(
  backendId: string,
  viewer: Viewer,
  now = new Date(),
): boolean {
  if (viewer.can("backend.inspect")) return true;

  return problemsServedBy(backendId).some(
    (slug) => problemFor(slug, viewer, now) !== undefined,
  );
}

export function backendsFor(viewer: Viewer, now = new Date()): string[] {
  return Object.keys(backends).filter((id) => canSeeBackend(id, viewer, now));
}
