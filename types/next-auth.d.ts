import type { DefaultSession } from "next-auth";
import type { RoleId } from "@/lib/auth/policy";

declare module "next-auth" {
  interface Session {
    user: {
      /** Empty when the token no longer matches an active roster entry. */
      handle: string;
      displayName: string;
      role: RoleId;
    } & DefaultSession["user"];
  }

  /**
   * What `authorize` returns. Display name and role are absent on purpose:
   * they are derived from the roster in the session callback rather than
   * frozen into the token.
   */
  interface User {
    handle: string;
  }
}
