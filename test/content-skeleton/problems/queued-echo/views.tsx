"use client";

/**
 * How this problem draws what came back, found by
 * `content-problem-view-modules.ts`.
 *
 * The skeleton fills this slot on exactly one of its three problems, on
 * purpose. `inline-echo` and `withdrawn` ship no `views.tsx` at all, so their
 * submissions render through the kernel's JSON dump — which is what proves the
 * slot is genuinely optional and that a problem deleted from the repository
 * still has a readable history.
 *
 * Nothing is shared here the way `content/problems/_shared/views/` shares it,
 * because with one consumer there is nothing to share.
 */
export function PayloadView({ payload }: { payload: unknown }) {
  const text =
    typeof payload === "object" && payload !== null
      ? (payload as { text?: unknown }).text
      : undefined;

  if (typeof text !== "string") return null;

  return (
    <pre className="text-fg overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
      {text}
    </pre>
  );
}
