"use client";

/**
 * Shows back the three payload shapes this deployment's `SubmitPanel` posts.
 *
 * The counterpart of the `onSubmit` in `content/components/submit-panel.tsx`,
 * and it has to be: `{ language, source }`, `{ flag }` and `{ text }` are a
 * convention between those two files and nothing upstream agrees with them.
 * The kernel stores the object and hands it back untouched.
 *
 * Shared rather than written once per problem because the submitter is shared
 * — every problem using the stock panel posts one of these three. A problem
 * with its own submitter writes its own view beside it; a problem that names
 * neither falls through to the kernel's dump, see `PayloadBody`.
 */
function describe(payload: unknown): { text: string; label: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  if (typeof record.source === "string") {
    const language =
      typeof record.language === "string" ? record.language : "代码";
    return { text: record.source, label: language };
  }
  if (typeof record.flag === "string") {
    return { text: record.flag, label: "flag" };
  }
  if (typeof record.text === "string") {
    return { text: record.text, label: "文本" };
  }
  return null;
}

export function PayloadView({ payload }: { payload: unknown }) {
  const described = describe(payload);
  if (!described) {
    return (
      <pre className="text-fg-muted overflow-x-auto font-mono text-xs">
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-fg-subtle font-mono text-xs">{described.label}</p>
      <pre className="text-fg overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
        {described.text}
      </pre>
    </div>
  );
}
