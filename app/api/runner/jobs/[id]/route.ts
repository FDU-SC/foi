import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { SignedRequest } from "@/lib/backend/signature";
import { jobReportSchema } from "@/lib/backend/types";
import { readJsonBody } from "@/lib/body-limit";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { guardRequest } from "@/lib/ratelimit/gate";
import { jobPath, signedByAnyBackend, verifyRunner } from "@/lib/runner/auth";
import {
  jobDetails,
  reportAlive,
  reportDone,
  reportFailed,
} from "@/lib/runner/queue";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024 * 1024;

async function backendOf(id: string): Promise<string | null> {
  const [row] = await db
    .select({ backendId: submissions.backendId })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  return row?.backendId ?? null;
}

const UNPROVEN = "签名不匹配";

async function authorizeJob(
  request: Request,
  id: string,
  signed: SignedRequest,
): Promise<NextResponse | null> {
  const backendId = await backendOf(id);

  if (backendId) {
    const signature = verifyRunner(backendId, request, signed);
    if (signature.ok) return null;

    const reason = signedByAnyBackend(request, signed)
      ? signature.reason
      : UNPROVEN;
    return NextResponse.json({ error: reason }, { status: 401 });
  }

  return signedByAnyBackend(request, signed)
    ? NextResponse.json({ error: "提交不存在" }, { status: 404 })
    : NextResponse.json({ error: UNPROVEN }, { status: 401 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gated = guardRequest(request, "GET /api/runner/jobs/[id]");
  if (gated) return gated;

  const { id } = await params;
  const url = new URL(request.url);

  const signed = { method: "GET", path: jobPath(id) + url.search, body: "" };

  const refused = await authorizeJob(request, id, signed);
  if (refused) return refused;

  const lease = url.searchParams.get("lease");
  const details = lease ? await jobDetails(id, lease) : null;

  if (!details) {
    return NextResponse.json(
      { error: "lease 已失效，这份提交不再由你持有" },
      { status: 409 },
    );
  }

  return NextResponse.json(details, {
    headers: { "cache-control": "no-store" },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gated = guardRequest(request, "PUT /api/runner/jobs/[id]");
  if (gated) return gated;

  const { id } = await params;

  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) {
    switch (read.reason) {
      case "too-large":
        return NextResponse.json({ error: "上报内容过大" }, { status: 413 });
      case "invalid-json":
        return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
  }
  const { body } = read;

  const parsed = jobReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "上报格式不合法" }, { status: 400 });
  }

  const signed = {
    method: "PUT",
    path: jobPath(id) + new URL(request.url).search,
    body: read.raw,
  };

  const refused = await authorizeJob(request, id, signed);
  if (refused) return refused;

  const report = parsed.data;
  const accepted =
    report.state === "alive"
      ? await reportAlive(id, report.lease, report.status)
      : report.state === "done"
        ? await reportDone(
            id,
            report.lease,
            report.verdict,
            report.backendVersion,
          )
        : await reportFailed(
            id,
            report.lease,
            report.reason,
            report.backendVersion,
          );

  if (!accepted) {
    return NextResponse.json(
      { error: "lease 已失效，这次上报没有被采纳" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
