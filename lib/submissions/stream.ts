import "server-only";
import type { Viewer } from "@/lib/authz/viewer";
import { log } from "@/lib/log";
import { observeSubmission } from "./observe";
import type { SubmissionView } from "./types";

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const SLOW_READER_MS = 15_000;

/** Pull-driven SSE: retain only the latest unsent snapshot, never an event backlog. */
export function submissionStream({ id, viewer, initial, signal, onClose }: {
  id: string;
  viewer: Viewer;
  initial: SubmissionView;
  signal: AbortSignal;
  onClose: () => void;
}): ReadableStream<Uint8Array> {
  const lifetime = new AbortController();
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let observed = false;
  let demand = false;
  let retry = true;
  let ping = false;
  let pending: SubmissionView | undefined;
  let slowReader: ReturnType<typeof setTimeout> | undefined;

  function finish(error?: unknown, cancelled = false) {
    if (closed) return;
    closed = true;
    pending = undefined;
    clearTimeout(slowReader);
    signal.removeEventListener("abort", abort);
    lifetime.abort();
    onClose();
    if (cancelled) return;
    if (error === undefined) controller.close();
    else controller.error(error);
  }

  function abort() { finish(signal.reason); }

  function flush() {
    if (closed) return;
    try {
      if (demand && (retry || pending || ping)) {
        let text: string;
        if (retry) {
          text = "retry: 5000\n\n";
          retry = false;
        } else if (pending) {
          text = `data: ${JSON.stringify(pending)}\n\n`;
          pending = undefined;
          ping = false;
        } else {
          text = ": ping\n\n";
          ping = false;
        }
        if (text.length > MAX_FRAME_BYTES) throw new Error("提交事件帧超过大小限制");
        const bytes = encoder.encode(text);
        if (bytes.byteLength > MAX_FRAME_BYTES) throw new Error("提交事件帧超过大小限制");
        demand = false;
        controller.enqueue(bytes);
        clearTimeout(slowReader);
        slowReader = undefined;
      }

      if (observed && !retry && !pending) { finish(); return; }
      if ((retry || pending || ping) && slowReader === undefined) {
        // New snapshots do not extend the deadline; only successful delivery does.
        slowReader = setTimeout(() => finish(new Error("提交事件流读取超时")), SLOW_READER_MS);
      }
    } catch (error) {
      finish(error);
    }
  }

  return new ReadableStream<Uint8Array>({
    start(output) {
      controller = output;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      void observeSubmission({
        id, viewer, initial, signal: lifetime.signal,
        onView(view) { if (!closed) { pending = view; flush(); } },
        onHeartbeat() { if (!closed) { ping = true; flush(); } },
      }).then(() => {
        observed = true;
        flush();
      }, (error) => {
        if (closed) return;
        log.error({ id, err: error }, "提交事件流失败");
        finish(error);
      });
      flush();
    },
    pull() { demand = true; flush(); },
    cancel() { finish(undefined, true); },
  }, { highWaterMark: 0 });
}
