"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export interface AppErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export function AppErrorView({ error, retry }: AppErrorProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-fg text-2xl font-semibold tracking-tight">出错了</h1>

      {error.digest ? (
        <p className="text-fg-subtle text-xs">
          错误编号{" "}
          <code className="bg-surface-2 rounded px-1.5 py-0.5 font-mono">
            {error.digest}
          </code>
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <Button variant="primary" onClick={() => retry()}>
          重试
        </Button>
        <Link
          href="/"
          className="text-fg-subtle hover:text-fg text-sm underline"
        >
          回首页
        </Link>
      </div>
    </div>
  );
}
