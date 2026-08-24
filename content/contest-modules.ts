import "server-only";

/** Contest schedules and entry rules are server-only content. */
export const contestModules = import.meta.glob("./contests/*/contest.ts", {
  eager: true,
});
