"use client";

export function CodePayloadView({ payload }: { payload: unknown }) {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.source !== "string") return null;

  const language =
    typeof record.language === "string" ? record.language : "代码";

  return (
    <div className="space-y-2">
      <p className="text-fg-subtle font-mono text-xs">{language}</p>
      <pre className="text-fg overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
        {record.source}
      </pre>
    </div>
  );
}
