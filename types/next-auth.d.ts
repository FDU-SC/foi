import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/auth/session";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      handle: string;
      displayName: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    handle: string;
    displayName: string;
    role: UserRole;
  }
}
