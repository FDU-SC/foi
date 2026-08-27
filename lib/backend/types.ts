import { z } from "zod";
import type { BadgeTone } from "@/lib/presentation";

export interface ProblemBackend {

  url?: string;

  secret?: string;

  replyTimeoutMs?: number;
}

export const INLINE_BACKEND_ID = "inline";

export const INLINE_BACKEND_VERSION = "inline";

export type SubmissionState = "queued" | "judging" | "completed" | "disrupted";

export function isSettled(state: SubmissionState): boolean {
  return state === "completed" || state === "disrupted";
}

export const SETTLED_STATES: SubmissionState[] = ["completed", "disrupted"];

export type SubmissionRecordState = "pending" | "completed" | "disrupted";

export const TERMINAL_RECORD_STATES: SubmissionRecordState[] = [
  "completed",
  "disrupted",
];

export const verdictSchema = z.object({
  result: z.record(z.string(), z.unknown()),
  detail: z.unknown().optional(),
});

export type Verdict = z.infer<typeof verdictSchema>;

export interface BackendUser {
  uid: number;
  groups: readonly string[];
}

export interface BackendActionRequest {
  action: string;
  user: BackendUser;
  problem: { slug: string; config: unknown };
  contestSlug: string | null;
  payload: unknown;
}

const backendVersionSchema = z.string().min(1).max(64);

const runnerStatusSchema = z.string().min(1).max(200);

export const jobRequestSchema = z.object({
  backendId: z.string().min(1).max(64),
  runnerId: z.string().min(1).max(64),
  nonce: z.string().min(16).max(64),
});

export interface JobTicket {
  id: string;
  lease: string;
}

export interface JobDetails {
  id: string;
  user: BackendUser;
  problem: { slug: string; config: unknown };
  contestSlug: string | null;
  payload: unknown;
}

export const jobReportSchema = z.discriminatedUnion("state", [
  z.object({
    lease: z.string().min(1).max(128),
    state: z.literal("alive"),
    status: runnerStatusSchema.optional(),
  }),
  z.object({
    lease: z.string().min(1).max(128),
    state: z.literal("done"),
    verdict: verdictSchema,
    backendVersion: backendVersionSchema,
  }),
  z.object({
    lease: z.string().min(1).max(128),
    state: z.literal("failed"),
    reason: z.string().min(1).max(500),
    backendVersion: backendVersionSchema,
  }),
]);

export type JobReport = z.infer<typeof jobReportSchema>;

export const STATE_PRESETS: Record<
  SubmissionState,
  { label: string; tone: BadgeTone }
> = {
  queued: { label: "排队中", tone: "info" },
  judging: { label: "评测中", tone: "info" },
  completed: { label: "已完成", tone: "neutral" },
  disrupted: { label: "评测中断", tone: "warn" },
};

const DEFAULT_DISRUPTED_REASON =
  "评测未能完成，这不是你这次提交的问题。请联系管理员重判。";

export function failureReason(submission: {
  state: SubmissionState;
  error: string | null;
}): string | null {
  if (submission.state !== "disrupted") return null;
  return submission.error ?? DEFAULT_DISRUPTED_REASON;
}
