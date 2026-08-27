import "server-only";

export const backendModules = import.meta.glob("./backends.ts", {
  eager: true,
});
