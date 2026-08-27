import "server-only";

export const contestModules = import.meta.glob("./contests/*/contest.ts", {
  eager: true,
});
