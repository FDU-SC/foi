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
        session.user.role = "user";
        return session;
      }

      // Most people have no entry here at all — they signed themselves up, so
      // they are ordinary competitors. An entry that exists and is suspended
      // is a revocation the repository can make on its own, and it still lands
      // on the next request.
      const grant = getMember(handle);
      if (grant?.disabled) {
        session.user.handle = "";
        session.user.displayName = "";
        session.user.role = "user";
        return session;
      }

      session.user.handle = handle;
      // A placeholder until `getResolvedUser()` reads the real one. Nothing
      // renders this: pages take their display name from the resolved user.
      session.user.displayName = grant?.displayName ?? handle;
      session.user.role = grant?.role ?? "user";
      return session;
    },
  },
} satisfies NextAuthConfig;
