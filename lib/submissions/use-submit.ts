"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProblem } from "@/components/problem/problem-context";
import { isTerminalState } from "@/lib/backend/types";
import type { SubmissionView } from "@/lib/submissions/types";

const POLL_INTERVALS_MS = [800, 1200, 2000, 3000, 5000];

/**
 * Submits to the kernel and tracks the result.
 *
 * Live updates arrive over SSE, but a poll runs alongside it as a fallback:
 * an SSE frame can be lost to a proxy timeout or a dropped connection, and a
 * judge callback can be lost entirely. Whichever channel notices the terminal
 * state first wins.
 */
export function useSubmit() {
  const { config, contestSlug, canAct } = useProblem();
  const [submission, setSubmission] = useState<SubmissionView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const track = useCallback((id: string) => {
    cleanupRef.current?.();

    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const finish = (next: SubmissionView) => {
      setSubmission((previous) => {
        // SSE frames carry no queue position (computing one per frame would
        // mean hitting every judge on every state change), so hold onto the
        // last polled position until the submission reaches a verdict.
        if (next.queue !== undefined || isTerminalState(next.state)) return next;
        return { ...next, queue: previous?.queue ?? null };
      });
      if (isTerminalState(next.state)) stop();
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/submissions/${id}`, {
          cache: "no-store",
        });
        if (res.ok) finish((await res.json()) as SubmissionView);
      } catch {
        // Network hiccup; the next tick retries.
      }
      if (stopped) return;
      const delay =
        POLL_INTERVALS_MS[Math.min(attempt++, POLL_INTERVALS_MS.length - 1)];
      pollTimer = setTimeout(poll, delay);
    };

    const source = new EventSource(`/api/submissions/stream?id=${id}`);
    source.onmessage = (event) => {
      try {
        finish(JSON.parse(event.data) as SubmissionView);
      } catch {
        // Ignore malformed frames; polling still covers us.
      }
    };
    source.onerror = () => {
      // EventSource retries on its own. Polling is already running, so there
      // is nothing extra to do here.
    };

    function stop() {
      stopped = true;
      clearTimeout(pollTimer);
      source.close();
      cleanupRef.current = null;
    }

    cleanupRef.current = stop;
    pollTimer = setTimeout(poll, POLL_INTERVALS_MS[0]);
  }, []);

  const submit = useCallback(
    async (payload: unknown) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problemSlug: config.slug,
            contestSlug,
            payload,
          }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `提交失败 (${res.status})`);
        }

        const created = (await res.json()) as SubmissionView;
        setSubmission(created);
        if (!isTerminalState(created.state)) track(created.id);
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : "提交失败");
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [config.slug, contestSlug, track],
  );

  return { submit, submission, submitting, error, canAct };
}
