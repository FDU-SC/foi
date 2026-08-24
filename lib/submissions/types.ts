import { z } from "zod";
import type { SubmissionState, Verdict } from "@/lib/backend/types";
import type { QueuePosition } from "@/lib/backend/queue-lookup";

/** What the client sees about a submission. */
export interface SubmissionView {
  id: string;
  problemSlug: string;
  contestSlug: string | null;
  state: SubmissionState;
  verdict: Verdict | null;
  createdAt: string;
  judgedAt: string | null;
  /**
   * Where the submission sits in its judge's queue. Only filled in by paths
   * that poll the judges; SSE frames omit it, so clients keep the last known
   * position until the next poll or until the submission reaches a verdict.
   */
  queue?: QueuePosition | null;
}

export const createSubmissionSchema = z.object({
  problemSlug: z.string().min(1),
  contestSlug: z.string().nullable().optional(),
  /**
   * Opaque to the kernel. The statement's submitter decides the shape and the
   * judge decides how to read it.
   */
  payload: z.unknown(),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export interface SubmissionListItem extends SubmissionView {
  handle: string;
  /** Resolved from the roster at read time, not stored on the row. */
  displayName: string;
  problemTitle: string;
}

export type { QueuePosition, SubmissionState, Verdict };
