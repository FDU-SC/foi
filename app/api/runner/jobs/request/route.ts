import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/body-limit";
import { guardRequest } from "@/lib/ratelimit/gate";
import { jobRequestSchema } from "@/lib/backend/types";
import { CLAIM_PATH, verifyRunner } from "@/lib/runner/auth";
import { claimJob } from "@/lib/runner/queue";
import { claimNonces } from "@/lib/runner/replay";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(request: Request) {

  const gated = guardRequest(request, "POST /api/runner/jobs/request");
  if (gated) return gated;

  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) {
    switch (read.reason) {
      case "too-large":
        return NextResponse.json({ error: "请求体过大" }, { status: 413 });
      case "invalid-json":
        return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
  }
  const { body } = read;

  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "领取请求格式不合法" }, { status: 400 });
  }

  const signature = verifyRunner(parsed.data.backendId, request, {
    method: "POST",
    path: CLAIM_PATH,
    body: read.raw,
  });
  if (!signature.ok) {
    return NextResponse.json({ error: signature.reason }, { status: 401 });
  }

  if (!claimNonces.firstUse(parsed.data.backendId, parsed.data.nonce)) {
    return NextResponse.json({ error: "nonce 已被使用" }, { status: 401 });
  }

  const ticket = await claimJob(parsed.data.backendId, parsed.data.runnerId);

  if (!ticket) return new NextResponse(null, { status: 204 });

  return NextResponse.json(ticket, {
    headers: { "cache-control": "no-store" },
  });
}
