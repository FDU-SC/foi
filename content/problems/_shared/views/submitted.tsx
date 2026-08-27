"use client";

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
