import { z } from "zod";
import type { SubmissionState, Verdict } from "@/lib/backend/types";
import type { QueuePosition } from "@/lib/backend/queue-lookup";

/** What the client sees about a submission. */
export interface SubmissionView {
  id: string;
  problemSlug: string;
  contestSlug: string | null;
  state: SubmissionState;

  /**
   * The backend's reply, verbatim, for a problem's own components to read
   * `detail` out of. Generic UI uses the four fields below instead — they are
   * what the kernel resolved on arrival, and they are defined even for a
   * backend whose reply says nothing but a status.
   */
  verdict: Verdict | null;
  outcome: string | null;
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;

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
