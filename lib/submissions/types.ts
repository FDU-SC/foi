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

  /**
   * Why there is no verdict, for the one state that has a reason. Null
   * otherwise, including while a submission is still in flight with a runner's
   * last words recorded against it — see `failureReason`. Not the `error`
   * column: that is the raw text, and this is the question a player is asking.
   */
  reason: string | null;

  /**
   * What the runner holding this says it is doing, in its own words, or null.
   *
   * Opaque both ways: a backend author writes it and a statement's component
   * may render it, and nothing between the two reads it. Present on every
   * channel including SSE frames, unlike `queue` below, because it changes
   * while the submission is being judged and that is exactly when somebody is
   * watching.
   */
  runnerStatus: string | null;

  createdAt: string;
  judgedAt: string | null;
  /**
   * Where the submission sits in its backend's queue. Only filled in by paths
   * that ask for it; SSE frames omit it, so clients keep the last known
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
  /**
   * The client's name for this attempt, so a retry is answered from the row
   * the first try made rather than judged again. Optional because a script
   * posting straight to this endpoint has no retry loop to protect, and
   * because the column it lands in tolerates nulls for exactly that reason —
   * see `submissions.clientNonce`.
   *
   * Bounded like any other string arriving from a browser. Nothing reads it
   * back out, so the shape is the client's business; the length is not.
   */
  clientNonce: z.string().min(1).max(64).optional(),
});

export interface SubmissionListItem extends SubmissionView {
  handle: string;
  /** Resolved from the roster at read time, not stored on the row. */
  displayName: string;
  problemTitle: string;
}

export type { QueuePosition, SubmissionState, Verdict };
