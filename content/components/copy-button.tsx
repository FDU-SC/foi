"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "text-fg-subtle hover:text-fg hover:bg-surface-3 rounded px-1.5 py-0.5",
        "text-[11px] font-medium transition-colors",
        className,
      )}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}
