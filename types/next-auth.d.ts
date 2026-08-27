import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {

      handle: string;
      displayName: string;
      groups: string[];

      passwordAt: number;
    } & DefaultSession["user"];
  }

  interface User {
    handle: string;
    passwordAt: number;
  }
}
