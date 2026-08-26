import type { NextAuthConfig } from "next-auth";
import { groupsFor } from "@/lib/enrollment/registry";

/**
 * Claims FOI stores on the JWT.
 *
 * The handle, and the instant the password behind it was last written. Nothing
 * about the person rides along: a claim on the token does not reach anyone
 * until it expires, so somebody demoted or suspended would keep their old
 * powers for up to a week. Resolving on every request costs a Map lookup and
 * one indexed read, and makes both an edit to `content/enrollment/` and a
 * suspension take effect on the next page load.
 *
 * `credentialsAt` is the exception, and it is here for the opposite reason: it
 * is a fact about the token rather than about the person. It says which
 * password this session was issued against, so that `getResolvedUser` can
 * compare it with the current one and refuse a session older than the last
 * reset. Re-deriving it would defeat the point — it has to be frozen.
 *
 * Declared locally rather than by augmenting `next-auth/jwt`: that module only
 * re-exports `@auth/core/jwt`, which pnpm does not expose at the project root,
 * so the augmentation would silently not apply.
 */
interface FoiClaims {
  handle: string;
  /** `credentials.updatedAt` as of sign-in, in epoch milliseconds. */
  credentialsAt: number;
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
        const claims: FoiClaims = {
          handle: user.handle,
          credentialsAt: user.credentialsAt,
        };
        Object.assign(token, claims);
      }
      return token;
    },
    session({ session, token }) {
      const claims = token as Partial<FoiClaims>;
      const handle = claims.handle;

      // An empty handle is how the rest of the app spells "not signed in".
      if (!handle) {
        session.user.handle = "";
        session.user.displayName = "";
        session.user.groups = [];
        session.user.credentialsAt = 0;
        return session;
      }

      session.user.handle = handle;
      // Zero for a token minted before this claim existed, which is older than
      // any credentials row and so fails the comparison in `getResolvedUser`.
      session.user.credentialsAt = claims.credentialsAt ?? 0;
      // A placeholder until `getResolvedUser()` reads the real one. Nothing
      // renders this: pages take their display name from the resolved user.
      session.user.displayName = handle;

      // The address is deliberately not looked up: that would need the
      // database, and this config exists to be usable without one. What comes
      // back is therefore only what the handle-keyed rules confer — which is
      // exactly the set that can carry capabilities, and is why `proxy.ts` can
      // ask `can("admin.access")` here at all.
      //
      // That makes it load-bearing rather than incidental. Were an `email`
      // rule ever allowed to confer a capability, this call would silently
      // stop seeing it and the proxy would turn administrators away from
      // /admin with nothing in any log to say why. Ordinary cohorts are
      // missing here for the same reason, which is fine: nothing the proxy
      // decides depends on them.
      session.user.groups = groupsFor(handle, null);
      return session;
    },
  },
} satisfies NextAuthConfig;
