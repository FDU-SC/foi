import type { NextAuthConfig } from "next-auth";
import { getMember } from "@/lib/roster/registry";

/**
 * Claims FOI stores on the JWT.
 *
 * Only the handle. Role and display name used to ride along, which meant a
 * roster change did not reach anyone until their token expired — someone
 * demoted or suspended kept their old powers for up to a week. Resolving from
 * the registry on every request costs a Map lookup and makes an edit to
 * `content/roster/` take effect on the next page load.
 *
 * Declared locally rather than by augmenting `next-auth/jwt`: that module only
 * re-exports `@auth/core/jwt`, which pnpm does not expose at the project root,
 * so the augmentation would silently not apply.
 */
interface FoiClaims {
  handle: string;
}

/**
 * The half of the Auth.js config that carries no database dependency, so
 * `proxy.ts` can instantiate a client from it cheaply. The roster registry is
 * a compile-time artefact with no I/O, so it is safe to reach for here.
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
        const claims: FoiClaims = { handle: user.handle };
        Object.assign(token, claims);
      }
      return token;
    },
    session({ session, token }) {
      const handle = (token as Partial<FoiClaims>).handle;
      const member = handle ? getMember(handle) : undefined;

      // An empty handle is how the rest of the app spells "not signed in".
      // Falling through to it means a token outlives its roster entry by one
      // request at most, whether the entry was deleted or merely disabled.
      if (!member || member.disabled) {
        session.user.handle = "";
        session.user.displayName = "";
        session.user.role = "user";
        return session;
      }

      session.user.handle = member.handle;
      session.user.displayName = member.displayName;
      session.user.role = member.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
