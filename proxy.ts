import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { viewerFor } from "@/lib/auth/viewer";
import { isResolvedSource, sourceFrom } from "@/lib/ratelimit/source";
import { createFixedWindow } from "@/lib/ratelimit/window";

// Instantiated from the database-free config: the proxy only reads the JWT
// and resolves it against the roster registry.
const { auth } = NextAuth(authConfig);

/**
 * The global bound, and the only one that runs before anything is resolved.
 *
 * Its own counter, not the one on `globalThis` that `lib/ratelimit` keeps.
 * Next's documentation says proxy code "should not attempt relying on shared
 * modules or globals", and there is nothing to gain by disobeying it: the two
 * layers count different things — a source here, a person there — and never
 * share a key.
 *
 * What this layer is worth is position and coverage. Execution order is
 * `next.config` headers, redirects, **proxy**, then filesystem routing, so it
 * lands before page rendering and before the two indexed reads that
 * `getResolvedUser()` makes on every authenticated request. And because a
 * Server Function is a POST to the route it is used on, widening the matcher
 * put `login`, `registerAction`, `requestPasswordReset` and the rest behind it
 * without naming any of them.
 *
 * It is not a substitute for the bounds in `lib/ratelimit/policy.ts`, and the
 * documentation is blunt about why: "A matcher change or a refactor that moves
 * a Server Function to a different route can silently remove Proxy coverage."
 * Every one of those per-identity limits stays.
 */
const sources = createFixedWindow({
  // A public, source-keyed counter: the key space is chosen by whoever is
  // calling, so the ceiling is part of the design rather than housekeeping.
  maxKeys: 10_000,
});

/**
 * Requests one source may make per minute, across every page and Server
 * Action.
 *
 * Deliberately loose, for a reason specific to where this runs. A university
 * network puts an entire cohort behind one egress address, so a per-source
 * bound is collective: set it where one busy person would reach it and a full
 * lab sitting a contest trips it together. The bounds that shape what any one
 * person may do are keyed on an account and live in
 * `lib/ratelimit/policy.ts`; this one exists to stop a single machine
 * occupying the process, and twenty requests a second is far past browsing and
 * far short of that.
 *
 * A page view is worth several requests here — the document, its RSC payload,
 * and whatever Next prefetches on hover — while `_next/static` and
 * `_next/image` are excluded by the matcher and cost nothing.
 */
const PER_SOURCE = { max: 1_200, windowMs: 60_000 };

export default auth((req) => {
  const { nextUrl } = req;
  const user = req.auth?.user;
  const path = nextUrl.pathname;

  const source = sourceFrom(req.headers);

  // No trusted proxy in front means no source to count, and counting everybody
  // together would not be a weaker version of this bound — it would be one
  // shared budget for a whole deployment, which two people using staging at
  // once would exhaust between them. Skipping is the honest degradation, and
  // the safe direction: this raises the cost of volume, it is not what stops
  // anybody doing anything. See `lib/ratelimit/gate.ts`, which does the same.
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

/**
 * Everything except API routes and static assets.
 *
 * Widened from three page prefixes so the bound above covers pages and Server
 * Actions rather than the three areas that happened to need a redirect. The
 * path checks in the function do their own `startsWith`, so nothing else
 * changes by matching more.
 *
 * **`api` is excluded on purpose, and it is not an oversight to fix later.**
 * When proxy runs for a route, Next clones the request body and buffers it in
 * memory so that both proxy and the handler can read it. `lib/body-limit.ts`
 * counts bytes off the stream and cancels the read when a body goes over —
 * against a buffered clone that cancellation frees nothing, because the
 * memory has already been spent. `PUT /api/judge/callback` is the endpoint
 * that matters here: unauthenticated, and the place a 96 MiB body was measured
 * moving RSS by half a gigabyte before this was fixed. API routes take an
 * equivalent per-source bound on their own first line instead — see
 * `guardRequest` in `lib/ratelimit/gate.ts`, and the table that keeps track of
 * which ones have it.
 *
 * Two things deliberately *not* done:
 *
 * `_next/data` is left out of the pattern because excluding it does nothing —
 * the documentation says proxy runs for those routes regardless, on purpose,
 * so that protecting a page cannot accidentally leave its data route open.
 * Writing it in the list would only suggest otherwise.
 *
 * Prefetches are counted like anything else, even though `missing` on
 * `next-router-prefetch` looks made for skipping them. Skipping would mean a
 * caller could opt out of the global bound by sending a header, which is the
 * same mistake as reading the client's own `x-forwarded-for` entry. The
 * allowance above is sized to absorb them instead. They also cannot be told
 * apart inside the function: Next strips `rsc`, `next-router-state-tree` and
 * `next-router-prefetch` from `request.headers` here so that an RSC request
 * cannot accidentally be handled differently from the HTML one.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
