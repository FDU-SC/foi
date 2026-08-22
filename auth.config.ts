import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@/lib/auth/session";

/**
 * Claims FOI stores on the JWT.
 *
 * Declared locally rather than by augmenting `next-auth/jwt`: that module only
 * re-exports `@auth/core/jwt`, which pnpm does not expose at the project root,
 * so the augmentation would silently not apply.
 */
interface FoiClaims {
  id: string;
  handle: string;
  displayName: string;
  role: UserRole;
}

/**
 * The half of the Auth.js config that carries no database or Node-only
 * dependencies, so `proxy.ts` can instantiate a client from it cheaply.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  // Credentials provider does not support database sessions.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const claims: FoiClaims = {
          id: user.id as string,
          handle: user.handle,
          displayName: user.displayName,
          role: user.role,
        };
        Object.assign(token, claims);
      }
      return token;
    },
    session({ session, token }) {
      const claims = token as Partial<FoiClaims>;
      if (claims.id) {
        session.user.id = claims.id;
        session.user.handle = claims.handle ?? "";
        session.user.displayName = claims.displayName ?? claims.handle ?? "";
        session.user.role = claims.role ?? "user";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
