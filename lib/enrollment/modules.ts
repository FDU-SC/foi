import { enrollmentModules } from "@/content/_modules/enrollment";

export interface EnrollmentSource {

  path: string;

  groups?: unknown;

  policy?: unknown;

  rules?: unknown;
}

export function enrollmentSources(): EnrollmentSource[] {
  return Object.keys(enrollmentModules)
    .sort()
    .map((path) => ({
      path,
      ...(enrollmentModules[path] as Omit<EnrollmentSource, "path">),
    }));
}
