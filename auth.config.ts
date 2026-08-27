import type { NextAuthConfig } from "next-auth";

interface FoiClaims {
  uid: number;

  passwordAt: number;
}

export const authConfig = {
  basePath: "/api/auth",
  trustHost: !!process.env.FOI_PUBLIC_URL,

  pages: {
    signIn: "/login",
  },

  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const claims: FoiClaims = {
          uid: user.uid,
          passwordAt: user.passwordAt,
        };
        Object.assign(token, claims);
      }
      return token;
    },
    session({ session, token }) {
      const claims = token as Partial<FoiClaims>;

      session.user.uid = claims.uid ?? 0;
      session.user.passwordAt = claims.passwordAt ?? 0;

      return session;
    },
  },
} satisfies NextAuthConfig;
