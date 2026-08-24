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

  // A gate on the URL, not on the data behind it, and the distinction is not
  // academic: this answer comes from the token alone. The session callback in
  // `auth.config.ts` resolves the handle against the repository's grants and
  // never reads the accounts table, so a deleted or suspended account holding
  // a live JWT still looks signed in here, and still looks like an
  // administrator if a grant says so.
  //
  // What that buys is a cheap redirect for the ordinary case — nobody signed
  // in at all — on a matcher that runs for every prefetch. Refusing anybody is
  // the job of `getResolvedUser()`, which reads the account row on every
  // request, and of the access layers every page and route handler goes
  // through. This may be wrong; those may not.
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
