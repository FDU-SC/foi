import { NextResponse } from "next/server";
import { rateLimitBySource } from "@/lib/ratelimit";
import { ROUTE_LIMITS, type RouteKey } from "@/lib/ratelimit/policy";
import { sourceFrom } from "./source";

export const SOURCE_GATE = { max: 300, windowSeconds: 60 } as const;

export function guardRequest(
  request: Request,
  route: RouteKey,
): NextResponse | null {
  const flood = floodGate(request, route);
  if (flood) return flood;

  return originGate(request, route);
}

function floodGate(request: Request, route: RouteKey): NextResponse | null {

  const verdict = rateLimitBySource(
    `gate:${route}`,
    sourceFrom(request.headers),
    SOURCE_GATE.max,
    SOURCE_GATE.windowSeconds * 1000,
  );
  if (verdict.ok) return null;

  return tooManyRequests(verdict.retryAfterMs);
}

const FORM_CONTENT_TYPES = [
  "text/plain",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

function requestHost(request: Request): string | null {
  const header = request.headers.get("host");
  if (header) return header.toLowerCase();

  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

function originGate(request: Request, route: RouteKey): NextResponse | null {
  if (ROUTE_LIMITS[route].guard !== "same-origin") return null;

  const forbidden = () =>
    NextResponse.json({ error: "请求来源不合法" }, { status: 403 });

  const origin = request.headers.get("origin");
  if (origin) {
    const host = requestHost(request);

    let sender: string;
    try {
      sender = new URL(origin).host.toLowerCase();
    } catch {
      return forbidden();
    }

    if (!host || sender !== host) return forbidden();
  }

  const contentType = request.headers.get("content-type");
  if (!contentType) return null;

  const media = contentType.split(";")[0].trim().toLowerCase();
  if (!FORM_CONTENT_TYPES.includes(media)) return null;

  return NextResponse.json(
    { error: "请求的 Content-Type 不受支持" },
    { status: 415 },
  );
}

export function tooManyRequests(
  retryAfterMs: number,
  error = "请求过于频繁，请稍后再试",
): NextResponse {
  return NextResponse.json(
    { error },
    {
      status: 429,
      headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}
