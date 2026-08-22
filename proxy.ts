import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

// Instantiated from the database-free config: the proxy only reads the JWT.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const user = req.auth?.user;
  const path = nextUrl.pathname;

  const needsAuth =
    path.startsWith("/admin") ||
    path.startsWith("/submissions") ||
    path.startsWith("/judges");

  if (needsAuth && !user) {
    const login = new URL("/login", nextUrl);
    login.searchParams.set("next", path + nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (path.startsWith("/admin") && user?.role !== "admin") {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/submissions/:path*", "/judges/:path*"],
};
