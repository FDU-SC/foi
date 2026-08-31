import { NextResponse } from "next/server";
import { getAvatar } from "@/lib/accounts/queries";
import { guardRequest } from "@/lib/server/guard";

export const runtime = "nodejs";

/**
 * Only a URL that names the version it wants gets the immutable promise. A
 * bare hit has to revalidate, so a link shared without the query string can
 * never pin a stale face in a shared cache.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";

function missing(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const gated = guardRequest(request, "GET /api/avatars/[uid]");
  if (gated) return gated;

  const { uid } = await params;
  const id = Number(uid);
  if (!Number.isSafeInteger(id) || id < 1) return missing();

  // Public like the nickname beside it, and for the same reason not filtered
  // by account status: a suspended entrant still has a row on old standings.
  const avatar = await getAvatar(id);
  if (!avatar) return missing();

  const version = avatar.updatedAt.getTime();
  const etag = `"${id}-${version}"`;

  const asked = new URL(request.url).searchParams.get("v");
  const cacheControl = asked === String(version) ? IMMUTABLE : REVALIDATE;

  const headers = { etag, "cache-control": cacheControl };

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(new Uint8Array(avatar.image), {
    headers: { ...headers, "content-type": "image/webp" },
  });
}
