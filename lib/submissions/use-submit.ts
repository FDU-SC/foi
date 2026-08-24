"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProblem } from "@/components/problem/problem-context";
import { isSettled } from "@/lib/backend/types";
import type { SubmissionView } from "@/lib/submissions/types";

const POLL_INTERVALS_MS = [800, 1200, 2000, 3000, 5000];

/**
 * A name for one attempt, so that retrying it does not judge it twice.
 *
 * `getRandomValues` rather than `randomUUID`: the latter is restricted to
 * secure contexts, and an internal deployment reached over plain HTTP on a LAN
 * address is not one. Losing the key precisely where somebody self-hosts is
 * not a trade worth making for a shorter line.
 *
 * 128 bits because a collision within one account's submissions would hand
 * back the wrong row, which is worse than the duplicate this is preventing.
 */
function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

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

  /**
   * Held across attempts, which is the whole mechanism.
   *
   * A fresh nonce per click would protect nothing: the button is already
   * disabled while a submit is in flight, so two clicks are two submissions
   * and should be. What is not protected without this is the attempt whose
   * reply never came back — the request arrived, the row exists, the judge is
   * working, and all the browser saw was a dropped connection. Reusing the
   * nonce is what lets the next attempt be answered from that row instead of
   * queueing a second copy of the same work.
   *
   * Cleared only once a response is in hand, whatever it says: a refusal means
   * no row was created, so the next attempt is genuinely a new one.
   */
  const nonceRef = useRef<string | null>(null);

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

        // The same distinction `DispatchError` draws one layer down. Under 500
        // the kernel answered for itself — accepted, or refused before writing
        // anything — so the nonce has done its job and the next attempt is a
        // new submission. A 5xx says nothing about whether a row exists, which
        // is precisely the case worth holding it for.
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
