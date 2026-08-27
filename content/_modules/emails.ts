import "server-only";

export const emailModules = import.meta.glob("../emails/index.ts", {
  eager: true,
});
