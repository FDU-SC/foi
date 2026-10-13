import { z } from "zod";
import type { SubmissionState } from "@/lib/backend/types";
import type { QueuePosition } from "./queue-position";

export interface SubmissionView {
  id: string;
  problemSlug: string;
  contestSlug: string;
  state: SubmissionState;

  result: unknown;
  detail: unknown;

  reason: string | null;

  runnerStatus: string | null;

  /**
   * Which display preset interprets this problem's results.
   *
   * Absent for a problem that ships its own views, and null once no contest
   * carries it any more. It travels with the submission because the browser
   * reads results too, and it has no snapshot of the database to resolve from.
   */
  viewsPreset?: string | null;

  createdAt: string;
  judgedAt: string | null;

  queue: QueuePosition | null;
}

export const createSubmissionSchema = z.object({
  contestSlug: z.string().min(1),
  problemSlug: z.string().min(1),

  payload: z.unknown(),

  clientNonce: z.string().min(1).max(64).optional(),
});

export type CreateSubmission = z.infer<typeof createSubmissionSchema>;

export interface SubmissionListItem extends SubmissionView {
  uid: number;

  nickname: string;
  problemTitle: string;
}

export type { QueuePosition, SubmissionState };
