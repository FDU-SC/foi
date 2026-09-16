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
  const { config, contestSlug, canAct } = useProblem();
  const [submission, setSubmission] = useState<SubmissionView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const nonceRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => () => {
    generationRef.current += 1;
    cleanupRef.current?.();
  }, [contestSlug, config.slug]);

  const submit = useCallback(
    async (payload: unknown) => {
      const generation = ++generationRef.current;
      cleanupRef.current?.();
      cleanupRef.current = null;
      setSubmitting(true);
      setError(null);
      const clientNonce = (nonceRef.current ??= newNonce());
      try {
        const res = await fetch("/api/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contestSlug,
            problemSlug: config.slug,
            payload,
            clientNonce,
          }),
        });

        if (generation !== generationRef.current) return null;
        if (res.status < 500) nonceRef.current = null;

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
    [config.slug, contestSlug],
  );

  return { submit, submission, submitting, error, canAct };
}
