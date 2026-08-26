"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The last thing between an unhandled server error and a blank page.
 *
 * **Cannot branch on the error, and never will be able to.** This component
 * runs on the client, and Next replaces the message of anything thrown on the
 * server with a generic one before it crosses that boundary, leaving only
 * `error.digest`. Anything that needs to tell a refusal from a fault has to do
 * it on the server, before the throw escapes — which is what the three console
 * actions do with `ForbiddenError`.
 *
 * Placed at `app/` rather than inside `app/(site)/` so it also covers the
 * signed-out pages, which have no layout of their own. It does not wrap the
 * root layout — nothing but `global-error.tsx` can — and that is fine here: a
 * failure in `app/layout.tsx` means the document itself is broken, which the
 * default screen already reports honestly. The frame below is self-contained
 * because this page replaces the header and footer along with everything else.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
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

      {/*
        Shown rather than hidden: the digest is a hash of the error, carries
        nothing about the request, and is the only handle this page shares with
        the server log. Absent when the throw happened on the client, where
        there is no server log to point at.
      */}
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
