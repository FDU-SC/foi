import * as templates from "../emails";

/** At most one module: the platform refuses a second source of mail copy. */
export const emailModules = {
  "./emails/index.ts": templates,
};
