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
// Attached unconditionally rather than only in development. Next can place a
// module in more than one server bundle, and a second copy of this one would
// be a second bus: the callback handler would publish into one while the open
// SSE streams listened on the other, and the only symptom would be verdicts
// that never push — indistinguishable from a slow judge, and covered up by the
// client's polling fallback.
const bus = (globalThis.__foiSubmissionBus ??= new EventEmitter());
// One listener per open stream; the default cap of 10 would warn under load.
bus.setMaxListeners(0);

export function publish(view: SubmissionView): void {
  bus.emit(`submission:${view.id}`, view);
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
