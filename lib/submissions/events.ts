import { EventEmitter } from "node:events";
import type { SubmissionView } from "./types";

declare global {
  var __foiSubmissionBus: EventEmitter | undefined;
}

/**
 * Process-local fan-out from the callback handler to open SSE streams.
 *
 * Single-process deployments need nothing more. To run several processes,
 * replace the emit/subscribe bodies with Postgres LISTEN/NOTIFY — note that
 * LISTEN requires a dedicated, non-pooled connection, since PgBouncer in
 * transaction mode silently drops the subscription.
 */
const bus = globalThis.__foiSubmissionBus ?? new EventEmitter();
// One listener per open stream; the default cap of 10 would warn under load.
bus.setMaxListeners(0);
if (process.env.NODE_ENV !== "production") globalThis.__foiSubmissionBus = bus;

const ALL = "submission";

export function publish(view: SubmissionView): void {
  bus.emit(`submission:${view.id}`, view);
  bus.emit(ALL, view);
}

export function subscribe(
  submissionId: string,
  handler: (view: SubmissionView) => void,
): () => void {
  const channel = `submission:${submissionId}`;
  bus.on(channel, handler);
  return () => {
    bus.off(channel, handler);
  };
}

export function subscribeAll(
  handler: (view: SubmissionView) => void,
): () => void {
  bus.on(ALL, handler);
  return () => {
    bus.off(ALL, handler);
  };
}
