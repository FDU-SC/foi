import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Empty when the token no longer matches an active account. */
      handle: string;
      displayName: string;
      groups: string[];
    } & DefaultSession["user"];
  }

  /**
   * What `authorize` returns. Display name and group membership are absent on
   * purpose: they are derived on every request rather than frozen into the
   * token, so a change to `content/enrollment/` lands on the next page load.
   */
  interface User {
    handle: string;
  }
}
