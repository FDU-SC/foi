import { allows } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { backends } from "./registry";
import { problemsServedBy, servingBackendIds } from "./served";

export function canSeeBackend(
  backendId: string,
  viewer: Viewer,
  now = new Date(),
): boolean {
  return allows("backend.read", { id: backendId }, viewer, { now });
}

export function backendsFor(viewer: Viewer, now = new Date()): string[] {
  return Object.keys(backends).filter((id) => canSeeBackend(id, viewer, now));
}

/** Declared in `content/backends.ts` but judging nothing. */
export function orphanedBackends(): string[] {
  return Object.keys(backends).filter((id) => problemsServedBy(id).length === 0);
}

/** Named by a problem but missing from `content/backends.ts`. */
export function undeclaredBackends(): string[] {
  return servingBackendIds().filter((id) => !backends[id]);
}

export { problemsServedBy };
