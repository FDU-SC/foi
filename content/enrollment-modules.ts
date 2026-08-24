import "server-only";

/** Enrollment policy and grants must never enter the client module graph. */
export const enrollmentModules = import.meta.glob("./enrollment/*.ts", {
  eager: true,
});
