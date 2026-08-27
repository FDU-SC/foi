"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProblem } from "@/components/problem/problem-context";
import { isSettled } from "@/lib/backend/types";
import type { SubmissionView } from "@/lib/submissions/types";

const POLL_INTERVALS_MS = [800, 1200, 2000, 3000, 5000];

function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function useSubmit() {
  const { config, contestSlug, canAct } = useProblem();
  const [submission, setSubmission] = useState<SubmissionView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const nonceRef = useRef<string | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const track = useCallback((id: string) => {
    cleanupRef.current?.();

    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const finish = (next: SubmissionView) => {
      setSubmission((previous) => {

        if (next.queue !== undefined || isSettled(next.state)) return next;
        return { ...next, queue: previous?.queue ?? null };
      });
      if (isSettled(next.state)) stop();
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/submissions/${id}`, {
          cache: "no-store",
        });
        if (res.ok) finish((await res.json()) as SubmissionView);
      } catch {

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

      }
    };
    source.onerror = () => {

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
      const clientNonce = (nonceRef.current ??= newNonce());
      try {
        const res = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problemSlug: config.slug,
            contestSlug,
            payload,
            clientNonce,
          }),
        });

        if (res.status < 500) nonceRef.current = null;

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `提交失败 (${res.status})`);
        }

        const created = (await res.json()) as SubmissionView;
        setSubmission(created);
        if (!isSettled(created.state)) track(created.id);
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
