import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { viewerFor } from "@/lib/auth/viewer";

// Instantiated from the database-free config: the proxy only reads the JWT
// and resolves it against the roster registry.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const user = req.auth?.user;
  const path = nextUrl.pathname;

  // The session callback blanks the handle when the token no longer matches
  // an active roster entry, so this covers deleted and suspended members too.
  const signedIn = Boolean(user?.handle);

  const needsAuth =
    path.startsWith("/admin") ||
    path.startsWith("/submissions") ||
    path.startsWith("/judges");

  if (needsAuth && !signedIn) {
    const login = new URL("/login", nextUrl);
    login.searchParams.set("next", path + nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (path.startsWith("/admin") && !viewerFor(user).can("admin.access")) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/submissions/:path*", "/judges/:path*"],
};
