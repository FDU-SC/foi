import "server-only";
import { resolveUser } from "@/lib/accounts/resolve";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { isSettled } from "@/lib/backend/types";
import { readSnapshot } from "@/lib/db/read";
import { submissionFor } from "./access";
import { subscribe } from "./events";
import type { SubmissionView } from "./types";

const HEARTBEAT_MS = 20_000;

/** Observe readable snapshots until settlement, refusal, cancellation or failure. */
export function observeSubmission({ id, viewer, initial, signal, onView, onHeartbeat }: {
  id: string;
  viewer: Viewer;
  initial: SubmissionView;
  signal: AbortSignal;
  onView: (view: SubmissionView) => void;
  onHeartbeat: () => void;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const lifetime = new AbortController();
    let closed = false;
    let ready = false;
    let reading = false;
    let dirty = false;
    let currentViewer = viewer;
    let subscription: ReturnType<typeof subscribe> | undefined;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;

    function finish(error?: unknown) {
      if (closed) return;
      closed = true;
      clearTimeout(heartbeat);
      signal.removeEventListener("abort", cancel);
      subscription?.unsubscribe();
      lifetime.abort();
      if (error === undefined) resolve();
      else reject(error);
    }

    function cancel() { finish(); }

    function send(view: SubmissionView) {
      if (closed) return;
      onView(view);
      if (isSettled(view.state)) finish();
    }

    async function refresh() {
      dirty = true;
      if (!ready || reading || closed) return;
      reading = true;
      try {
        while (dirty && !closed) {
          dirty = false;
          const row = await submissionFor(id, currentViewer, lifetime.signal);
          if (closed) return;
          if (!row) { finish(); return; }
          send(row.view);
        }
      } catch (error) {
        finish(error);
      } finally {
        reading = false;
      }
    }

    async function beat() {
      try {
        const uid = viewer.uid;
        const account = uid === null ? null : await readSnapshot(
          (on) => resolveUser(uid, on), lifetime.signal,
        );
        if (closed) return;
        if (!account || account.disabled) { finish(); return; }
        currentViewer = viewerFor(account);
        await refresh();
        if (closed) return;
        onHeartbeat();
        heartbeat = setTimeout(beat, HEARTBEAT_MS);
      } catch (error) {
        finish(error);
      }
    }

    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { finish(); return; }
    try {
      send(initial);
      if (closed) return;
      subscription = subscribe(id, () => { void refresh(); }, (error) => finish(error));
      void subscription.ready.then(() => {
        if (closed) return;
        ready = true;
        // LISTEN now covers changes concurrent with this snapshot read.
        void refresh();
        heartbeat = setTimeout(beat, HEARTBEAT_MS);
      }).catch((error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}
