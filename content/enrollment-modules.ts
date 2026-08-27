import "server-only";

export const enrollmentModules = import.meta.glob("./enrollment/*.ts", {
  eager: true,
});
