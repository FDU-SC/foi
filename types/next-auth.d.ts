import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Empty when the token no longer matches an active account. */
      handle: string;
      displayName: string;
      groups: string[];
      /**
       * `accounts.passwordSetAt` as of sign-in, epoch milliseconds. Zero on a
       * token minted before the claim existed, and on no token at all.
       */
      passwordAt: number;
    } & DefaultSession["user"];
  }

  /**
   * What `authorize` returns. Display name and group membership are absent on
   * purpose: they are derived on every request rather than frozen into the
   * token, so a change to `content/enrollment/` lands on the next page load.
   * `passwordAt` is frozen for the opposite reason — see `auth.config.ts`.
   */
  interface User {
    handle: string;
    passwordAt: number;
  }
}
