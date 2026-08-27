import { z } from "zod";
import type { SubmissionState } from "@/lib/backend/types";
import type { QueuePosition } from "./queue-position";

export interface SubmissionView {
  id: string;
  problemSlug: string;
  contestSlug: string | null;
  state: SubmissionState;

  result: Record<string, unknown> | null;
  detail: unknown;

  reason: string | null;

  runnerStatus: string | null;

  createdAt: string;
  judgedAt: string | null;

  queue?: QueuePosition | null;
}

export const createSubmissionSchema = z.object({
  problemSlug: z.string().min(1),
  contestSlug: z.string().nullable().optional(),

  payload: z.unknown(),

  clientNonce: z.string().min(1).max(64).optional(),
});

export interface SubmissionListItem extends SubmissionView {
  uid: number;

  nickname: string;
  problemTitle: string;
}

export type { QueuePosition, SubmissionState };
