import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { guardRequest } from "@/lib/ratelimit/gate";

/**
 * Auth.js's handlers, behind the same first line as every other route here.
 *
 * The wrapper exists because this route used to be the one `/api/*` path with
 * neither layer of the per-source bound: `proxy.ts` excludes `api` from its
 * matcher, and re-exporting `handlers` whole left no first line to put
 * `guardRequest` on. Unmetered is not what anything decided, it is what fell
 * out of the export syntax.
 *
 * **The wrapper adds the flood cap and nothing else, and the table is what
 * says so.** `originGate` returns immediately for any guard that is not
 * `same-origin`, and both entries declare otherwise — `framework` for the
 * POST, because Auth.js runs its own double-submit CSRF check, and
 * `read-only` for the GET. So this is not a handler picking half a guard; it
 * is `guardRequest` applying what `ROUTE_LIMITS` declared, exactly as
 * everywhere else. A future entry that changes its mind and says
 * `same-origin` gets the origin check here without this file being touched.
 *
 * That mattering hinges on the guards being right, so: the POST really is
 * `application/x-www-form-urlencoded`, and a `same-origin` declaration would
 * refuse every sign-in through the form content-type rule. The entry says
 * `framework` because the check exists and is Auth.js's, not because it was
 * inconvenient to run ours.
 */
export async function GET(request: NextRequest) {
  const refused = guardRequest(request, "GET /api/auth/[...nextauth]");
  return refused ?? handlers.GET(request);
}

export async function POST(request: NextRequest) {
  const refused = guardRequest(request, "POST /api/auth/[...nextauth]");
  return refused ?? handlers.POST(request);
}
