"use client";

export function FlagPayloadView({ payload }: { payload: unknown }) {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.flag !== "string") return null;

  return (
    <div className="space-y-2">
      <p className="text-fg-subtle font-mono text-xs">flag</p>
      <pre className="text-fg overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
        {record.flag}
      </pre>
    </div>
  );
}
