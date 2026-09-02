import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { catalogueRedirect } from "@/lib/contests/catalogue";
import { isResolvedSource, sourceFrom } from "@/lib/server/source";
import { createFixedWindow } from "@/lib/ratelimit/window";

const { auth } = NextAuth(authConfig);

const sources = createFixedWindow({

  maxKeys: 10_000,
});

const PER_SOURCE = { max: 1_200, windowMs: 60_000 };

export default auth((req) => {
  const { nextUrl } = req;
  const user = req.auth?.user;
  const path = nextUrl.pathname;

  const source = sourceFrom(req.headers);

  if (isResolvedSource(source)) {
    const verdict = sources.take(source, PER_SOURCE.max, PER_SOURCE.windowMs);
    if (!verdict.ok) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: {
          "retry-after": String(Math.ceil(verdict.retryAfterMs / 1000)),
        },
      });
    }
  }

  // The catalogue keeps no address under `/contests`. It has to be said here:
  // a page body can only answer once its layout has streamed, which turns a
  // redirect into a 200 carrying a meta refresh. Temporary, because which
  // contest is the catalogue is a deployment's to change.
  const moved = catalogueRedirect(path);
  if (moved) {
    return NextResponse.redirect(new URL(moved + nextUrl.search, nextUrl), 307);
  }

  // A convenience redirect, not a boundary: the JWT alone says nothing about
  // groups, so no policy can be evaluated here. Every page and route below
  // asks `authorize` for itself, and a suspended or demoted session that slips
  // past this check is refused there.
  const signedIn = Boolean(user?.uid);

  const needsAuth =
    path.startsWith("/admin") ||
    path.startsWith("/submissions") ||
    path.startsWith("/judges") ||
    path.startsWith("/settings");

  if (needsAuth && !signedIn) {
    const login = new URL("/login", nextUrl);
    login.searchParams.set("next", path + nextUrl.search);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
