"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";

interface TestLike {
  name?: string;
  status?: string;
  score?: number;
  maxScore?: number;
  time?: number;
  memory?: number;
  message?: string;
}

function toneFor(test: TestLike): BadgeTone {
  if (test.status === "accepted") return "ok";
  if (test.score !== undefined && test.maxScore) {
    if (test.score >= test.maxScore) return "ok";
    if (test.score > 0) return "partial";
  }
  return test.status ? "err" : "neutral";
}

function extractTests(detail: unknown): TestLike[] | null {
  if (typeof detail !== "object" || detail === null) return null;
  const tests = (detail as { tests?: unknown }).tests;
  if (!Array.isArray(tests) || tests.length === 0) return null;
  return tests as TestLike[];
}

function extractMessage(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null) return null;
  const message = (detail as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : null;
}

export function VerdictDetail({ detail }: { detail: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const tests = extractTests(detail);
  const message = extractMessage(detail);

  if (!tests && !message && detail === undefined) return null;

  return (
    <div className="space-y-3">
      {message ? (
        <pre className="border-border bg-surface-2 text-fg-muted overflow-x-auto rounded border px-3 py-2 font-mono text-xs whitespace-pre-wrap">
          {message}
        </pre>
      ) : null}

      {tests ? (
        <div className="border-border overflow-hidden rounded border">
          <table className="w-full text-xs">
            <tbody className="divide-border divide-y">
              {tests.map((test, i) => (
                <tr key={i} className="hover:bg-surface-2/50">
                  <td className="text-fg-muted px-3 py-1.5 font-mono">
                    {test.name ?? `#${i + 1}`}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge tone={toneFor(test)} mono>
                      {test.status ?? "-"}
                    </Badge>
                  </td>
                  <td className="text-fg-muted px-3 py-1.5 text-right font-mono tabular-nums">
                    {test.score !== undefined
                      ? `${test.score}${test.maxScore ? `/${test.maxScore}` : ""}`
                      : ""}
                  </td>
                  <td className="text-fg-subtle px-3 py-1.5 text-right font-mono tabular-nums">
                    {test.time !== undefined ? `${test.time}ms` : ""}
                  </td>
                  <td className="text-fg-subtle px-3 py-1.5 text-right font-mono tabular-nums">
                    {test.memory !== undefined ? `${test.memory}KB` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail !== undefined && !tests && !message ? (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-fg-subtle hover:text-fg text-xs transition-colors"
          >
            {expanded ? "收起原始结果" : "展开原始结果"}
          </button>
          {expanded ? (
            <pre className="border-border bg-surface-2 text-fg-muted mt-2 max-h-64 overflow-auto rounded border px-3 py-2 font-mono text-xs">
              {JSON.stringify(detail, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
