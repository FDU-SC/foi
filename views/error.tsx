"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export interface AppErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export function AppErrorView({ error, retry }: AppErrorProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <div className="space-y-2">
        <h1 className="text-fg text-xl font-semibold tracking-tight">
          出错了
        </h1>
        <p className="text-fg-muted max-w-sm text-sm leading-relaxed">
          这一页没能渲染出来。可以先重试一次；如果一直这样，请联系管理员。
        </p>
      </div>

      {error.digest ? (
        <p className="text-fg-subtle text-xs">
          报错编号{" "}
          <code className="bg-surface-2 rounded px-1.5 py-0.5 font-mono">
            {error.digest}
          </code>
          ，服务器日志里能按它找到这一次。
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <Button variant="primary" onClick={() => retry()}>
          重试
        </Button>
        <Link href="/" className="text-fg-subtle hover:text-fg text-sm underline">
          回首页
        </Link>
      </div>
    </div>
  );
}
