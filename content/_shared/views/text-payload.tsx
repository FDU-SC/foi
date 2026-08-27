"use client";

export function TextPayloadView({ payload }: { payload: unknown }) {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.text !== "string") return null;

  return (
    <div className="space-y-2">
      <p className="text-fg-subtle font-mono text-xs">文本</p>
      <pre className="text-fg overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
        {record.text}
      </pre>
    </div>
  );
}
