import { isSettled } from "@/lib/backend/types";
import type { SubmissionView } from "./types";

const POLL_INTERVALS_MS = [800, 1200, 2000, 3000, 5000];
const MIN_INTERVAL_MS = 800;

function retryDelay(value: string | null): number {
  if (value === null) return 5000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 5000;
}

/** SSE and polling request refreshes; only this serial read chain publishes views. */
export function trackSubmission(
  id: string,
  onView: (view: SubmissionView) => void,
  onError: (message: string) => void,
): () => void {
  const request = new AbortController();
  let stopped = false;
  let reading = false;
  let dirty = false;
  let attempt = 0;
  let nextAllowed = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerAt = Infinity;
  let source: EventSource | undefined;

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    source?.close();
    request.abort();
  }

  function schedule(at: number) {
    if (stopped || reading) return;
    const due = Math.max(at, nextAllowed);
    if (timer !== undefined && timerAt <= due) return;
    clearTimeout(timer);
    timerAt = due;
    timer = setTimeout(() => { void read(); }, Math.max(0, due - Date.now()));
  }

  function refresh() {
    dirty = true;
    schedule(Date.now());
  }

  async function read() {
    timer = undefined;
    timerAt = Infinity;
    if (stopped) return;
    reading = true;
    dirty = false;
    nextAllowed = Date.now() + MIN_INTERVAL_MS;
    const timeout = new AbortController();
    const signal = AbortSignal.any([request.signal, timeout.signal]);
    const deadline = setTimeout(() => timeout.abort(), 20_000);
    try {
      const response = await fetch(`/api/submissions/${encodeURIComponent(id)}`, {
        cache: "no-store", signal,
      });
      if (stopped || signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) {
        stop();
        onError(response.status === 401 ? "请重新登录后查看提交" : "无法继续查看这条提交");
        return;
      }
      if (response.status === 429) {
        nextAllowed = Math.max(nextAllowed, Date.now() + retryDelay(response.headers.get("retry-after")));
      } else if (response.ok) {
        const view: SubmissionView = await response.json();
        if (stopped || signal.aborted) return;
        if (isSettled(view.state)) stop();
        onView(view);
      }
    } catch {
      // The next scheduled read retries transport and temporary server failures.
    } finally {
      clearTimeout(deadline);
      reading = false;
      const delay = POLL_INTERVALS_MS[Math.min(attempt++, POLL_INTERVALS_MS.length - 1)];
      schedule(dirty ? Date.now() : Date.now() + delay);
    }
  }

  try {
    source = new EventSource(`/api/submissions/stream?id=${encodeURIComponent(id)}`);
    source.onmessage = refresh;
    source.onerror = refresh;
  } catch {
    // Polling remains available when EventSource cannot be created.
  }
  schedule(Date.now() + POLL_INTERVALS_MS[0]);
  return stop;
}
