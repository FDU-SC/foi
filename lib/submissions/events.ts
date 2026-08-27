import { EventEmitter } from "node:events";
import type { SubmissionView } from "./types";

declare global {
  var __foiSubmissionBus: EventEmitter | undefined;
}

const bus = (globalThis.__foiSubmissionBus ??= new EventEmitter());

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
