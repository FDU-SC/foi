"use client";

import { CodePayloadView } from "./code-payload";
import { FlagPayloadView } from "./flag-payload";
import { TextPayloadView } from "./text-payload";

/**
 * Backward-compatible PayloadView that auto-detects payload type.
 * Prefer using CodePayloadView / FlagPayloadView / TextPayloadView directly
 * in per-problem views.tsx files.
 */
export function PayloadView({ payload }: { payload: unknown }) {
  if (typeof payload !== "object" || payload === null) {
    return (
      <pre className="text-fg-muted overflow-x-auto font-mono text-xs">
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.source === "string") return <CodePayloadView payload={payload} />;
  if (typeof record.flag === "string") return <FlagPayloadView payload={payload} />;
  if (typeof record.text === "string") return <TextPayloadView payload={payload} />;

  return (
    <pre className="text-fg-muted overflow-x-auto font-mono text-xs">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}
