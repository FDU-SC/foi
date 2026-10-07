"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProblem } from "@/components/problem/problem-context";
import { isSettled } from "@/lib/backend/types";
import type { SubmissionView } from "@/lib/submissions/types";
import { trackSubmission } from "./track";

function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function useSubmit() {
  const { config, contestSlug, permissions } = useProblem();
  const [submission, setSubmission] = useState<SubmissionView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // The server answers a known nonce with the row it already stored, so an
  // unanswered nonce may only be reused to retry the identical request.
  const attemptRef = useRef<{ request: string; nonce: string } | null>(null);
  const generationRef = useRef(0);

  useEffect(() => () => {
    generationRef.current += 1;
    cleanupRef.current?.();
  }, [contestSlug, config.slug]);

  const submit = useCallback(
    async (payload: unknown) => {
      if (!permissions.submit.allowed) {
        setError(permissions.submit.reason.message);
        return null;
      }
      const generation = ++generationRef.current;
      cleanupRef.current?.();
      cleanupRef.current = null;
      setSubmitting(true);
      setError(null);
      try {
        const request = JSON.stringify({ contestSlug, problemSlug: config.slug, payload });
        const attempt = attemptRef.current?.request === request
          ? attemptRef.current
          : { request, nonce: newNonce() };
        attemptRef.current = attempt;
        const res = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contestSlug,
            problemSlug: config.slug,
            payload,
            clientNonce: attempt.nonce,
          }),
        });

        if (generation !== generationRef.current) return null;
        if (res.status < 500) attemptRef.current = null;

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `提交失败 (${res.status})`);
        }

        const created = (await res.json()) as SubmissionView;
        if (generation !== generationRef.current) return null;
        setSubmission(created);
        if (!isSettled(created.state)) {
          cleanupRef.current = trackSubmission(created.id, setSubmission, setError);
        }
        return created;
      } catch (err) {
        if (generation === generationRef.current) {
          setError(err instanceof Error ? err.message : "提交失败");
        }
        return null;
      } finally {
        if (generation === generationRef.current) setSubmitting(false);
      }
    },
    [config.slug, contestSlug, permissions.submit],
  );

  return { submit, submission, submitting, error, permission: permissions.submit };
}
