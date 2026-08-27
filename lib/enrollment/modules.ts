import { enrollmentModules } from "@/content/enrollment-modules";

/**
 * Where enrolment content comes from, and in what order, answered once.
 *
 * Two registries are built out of these files — `lib/permissions/groups.ts` for the
 * `groups` a deployment declares, `lib/enrollment/registry.ts` for its
 * `policy` and `rules` — and neither may scan the glob itself. Two scans is
 * two answers to "which files count and which order do they contribute in",
 * and order is load-bearing here: rules accumulate in path order, which is
 * what makes the groups a person ends up in the same on every machine.
 *
 * Split into two registries rather than one because of where they are read
 * from, not because of where they are declared. `lib/permissions/groups.ts` is
 * reachable from `proxy.ts` through the session callback, so it must not pull
 * in the account normalisation and rule matching that `./registry.ts` needs.
 * This module is the shared half: it imports the glob and nothing else.
 */
export interface EnrollmentSource {
  /** The path the glob matched, for naming in an error. */
  path: string;
  /** Group declarations, unvalidated — see `lib/permissions/groups.ts`. */
  groups?: unknown;
  /** The registration policy, unvalidated — see `./registry.ts`. */
  policy?: unknown;
  /** Cohort rules, unvalidated — see `./registry.ts`. */
  rules?: unknown;
}

/**
 * Every file under `content/enrollment/`, sorted by path.
 *
 * Sorted so that rule order — and therefore the order groups come out in — is
 * the same on every machine, rather than whatever the glob happened to emit.
 */
export function enrollmentSources(): EnrollmentSource[] {
  return Object.keys(enrollmentModules)
    .sort()
    .map((path) => ({
      path,
      ...(enrollmentModules[path] as Omit<EnrollmentSource, "path">),
    }));
}
