import type { NextAuthConfig } from "next-auth";
import { groupsFor } from "@/lib/enrollment/registry";

interface FoiClaims {
  handle: string;

  passwordAt: number;
}

export const authConfig = {
  pages: {
    signIn: "/login",
  },

  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const claims: FoiClaims = {
          handle: user.handle,
          passwordAt: user.passwordAt,
        };
        Object.assign(token, claims);
      }
      return token;
    },
    session({ session, token }) {
      const claims = token as Partial<FoiClaims>;
      const handle = claims.handle;

      if (!handle) {
        session.user.handle = "";
        session.user.displayName = "";
        session.user.groups = [];
        session.user.passwordAt = 0;
        return session;
      }

      session.user.handle = handle;

      session.user.passwordAt = claims.passwordAt ?? 0;

      session.user.displayName = handle;

      session.user.groups = groupsFor(handle, null);
      return session;
    },
  },
} satisfies NextAuthConfig;
