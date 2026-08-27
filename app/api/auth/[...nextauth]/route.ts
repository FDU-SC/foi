import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { guardRequest } from "@/lib/server/guard";

export async function GET(request: NextRequest) {
  const refused = guardRequest(request, "GET /api/auth/[...nextauth]");
  return refused ?? handlers.GET(request);
}

export async function POST(request: NextRequest) {
  const refused = guardRequest(request, "POST /api/auth/[...nextauth]");
  return refused ?? handlers.POST(request);
}
