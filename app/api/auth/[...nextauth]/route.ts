import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { guardRequest } from "@/lib/ratelimit/gate";

/**
 * Auth.js's handlers, behind the same first line as every other route here.
 *
 * Wrapped rather than re-exported whole: `proxy.ts` excludes `api` from its
 * matcher, so without a first line to put `guardRequest` on this is the one
 * `/api/*` path with neither layer of the per-source bound.
 *
 * **The wrapper adds the flood cap and nothing else, and the table is what
 * says so.** `originGate` returns immediately for any guard that is not
 * `same-origin`, and both entries declare otherwise — `framework` for the
 * POST, because Auth.js runs its own double-submit CSRF check, and
 * `read-only` for the GET. So this is not a handler picking half a guard; it
 * is `guardRequest` applying what `ROUTE_LIMITS` declared. A future entry that
 * says `same-origin` gets the origin check here without this file being
 * touched — which would break sign-in, since the POST is
 * `application/x-www-form-urlencoded` and the content-type rule refuses that.
 */
export async function GET(request: NextRequest) {
  const refused = guardRequest(request, "GET /api/auth/[...nextauth]");
  return refused ?? handlers.GET(request);
}

export async function POST(request: NextRequest) {
  const refused = guardRequest(request, "POST /api/auth/[...nextauth]");
  return refused ?? handlers.POST(request);
}
