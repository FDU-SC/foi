import type { NextAuthConfig } from "next-auth";
import { getGrant, groupsFor } from "@/lib/enrollment/registry";

/**
 * Claims FOI stores on the JWT.
 *
 * Only the handle. Role and display name used to ride along, which meant a
 * change did not reach anyone until their token expired — someone demoted or
 * suspended kept their old powers for up to a week. Resolving on every request
 * costs a Map lookup for the role and one indexed read for the rest, and makes
 * both an edit to `content/enrollment/` and a suspension take effect on the
 * next page load.
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
 * `proxy.ts` can instantiate a client from it cheaply. The registry it reads
 * is a compile-time artefact with no I/O, so it is safe to reach for here.
 *
 * That constraint is why roles are the one thing still declared entirely in
 * the repository. Next's own guidance is that a proxy runs on every route,
 * prefetches included, and should read nothing but the cookie; because the
 * only question it asks is `can(user, "admin.access")`, and because the answer
 * comes from a compiled Map, it can keep obeying that.
 *
 * What this config produces is therefore an *optimistic* view. It knows the
 * handle in the token and what the repository grants that handle, and it does
 * not know whether the account behind it has since been suspended. That check
 * belongs to `getResolvedUser()` in `auth.ts`, which every protected page and
 * server action goes through.
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

      // An empty handle is how the rest of the app spells "not signed in".
      if (!handle) {
        session.user.handle = "";
        session.user.displayName = "";
        session.user.groups = [];
        return session;
      }

      // Almost nobody has an entry here: people sign themselves up, and an
      // ordinary competitor needs no grant. Revoking a role is a commit and
      // lands on the next request; suspending an account is a database write
      // and is caught one layer in, by `getResolvedUser()`.
      const grant = getGrant(handle);

      session.user.handle = handle;
      // A placeholder until `getResolvedUser()` reads the real one. Nothing
      // renders this: pages take their display name from the resolved user.
      session.user.displayName = grant?.displayName ?? handle;
      session.user.groups = groupsFor(handle, null);
      return session;
    },
  },
} satisfies NextAuthConfig;
