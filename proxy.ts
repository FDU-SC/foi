import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { viewerFor } from "@/lib/permissions/viewer";
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
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
