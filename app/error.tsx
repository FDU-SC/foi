"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The last thing between an unhandled server error and a blank page.
 *
 * There was no error boundary anywhere under `app/` until this one, so every
 * throw nobody caught fell through to Next's built-in screen — which in a
 * deployment says nothing an operator can act on and looks, to whoever hit it,
 * like the site being down. The one that made this worth writing is
 * `requireCapability`, whose refusal is an ordinary outcome rather than a
 * fault: a stale page still offering a button whose privilege has since been
 * revoked reaches it on every press. The three console actions catch
 * `ForbiddenError` themselves and answer their own form; this catches
 * everything that has no such answer.
 *
 * Deliberately says nothing about *what* went wrong, and that is not
 * politeness. This component runs on the client, and Next replaces the message
 * of anything thrown on the server with a generic one before it crosses that
 * boundary, leaving only `error.digest` to correlate against the server log.
 * So branching on the error here is not something that has been left undone —
 * it is not available, and a page that tried would be reading a string Next
 * wrote. Anything that needs to distinguish a refusal from a fault has to do
 * it on the server, before the throw escapes.
 *
 * Placed at `app/` rather than inside `app/(site)/`, so it also covers the
 * signed-out pages, which have no layout of their own to hang one off. It does
 * not wrap the root layout — nothing but `global-error.tsx` can — and that
 * split is deliberate here rather than a gap: `app/layout.tsx` renders fonts,
 * the theme script and a body, and a failure in it means the document itself
 * is broken, which the default screen already reports honestly. What sits
 * inside is the header and footer of `app/(site)/layout.tsx`, replaced by this
 * whole page, so the frame below is self-contained.
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
        The digest is the only thing this page knows that the server log also
        knows, so it is shown rather than hidden: it is a hash of the error and
        carries nothing about the request, and being read out to somebody is
        the whole point of it existing. Absent when the throw happened on the
        client, where there is no server log to point at.
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
