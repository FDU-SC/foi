import { NextResponse } from "next/server";
import type { DenialReason } from "./actions";
import type { Denial } from "./adapters";

/**
 * Denial codes carry the status; route handlers never pick one themselves.
 * Anything unlisted is a refusal of a request the platform did understand, so
 * it answers 403.
 */
const STATUS: Record<string, number> = {
  unauthenticated: 401,
  "not-found": 404,
  "contest-mismatch": 400,
};

function denialStatus(reason: DenialReason): number {
  return STATUS[reason.code] ?? 403;
}

export function apiDeny(denial: Denial): NextResponse {
  return NextResponse.json(
    { error: denial.reason.message, code: denial.reason.code },
    { status: denialStatus(denial.reason) },
  );
}
