"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useProblem } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/content/components/copy-button";

/** What `spawn` and `poll` both answer with. See this problem's backend. */
type InstanceView =
  | { status: "pulling"; instanceId: string }
  | { status: "ready"; instanceId: string; endpoint: string; expiresAt: number }
  | { status: "gone" };

/** How often to ask whether the container is up yet, once one is starting. */
const POLL_INTERVAL_MS = 1500;

/**
 * Per-problem infrastructure control.
 *
 * Spawning and destroying containers is not the kernel's business, and this
 * component does not ask it to be: it posts to `/action/<name>`, which relays
 * the call to whatever service `backend.id` names without looking inside.
 *
 * It goes through the kernel rather than straight at that service for two
 * reasons. The request has to be signed, and the shared secret cannot leave
 * the server. And the person making it has to be somebody the problem is
 * actually open to — this component used to call the backend directly with no
 * credentials at all, so anyone who could load the page, signed in or not,
 * could start containers on it.
 */
export function InstanceControl() {
  const { config, contestSlug, canAct } = useProblem();
  const [view, setView] = useState<InstanceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  const ready = view?.status === "ready" ? view : null;
  const pulling = view?.status === "pulling";

  const call = async (action: string): Promise<InstanceView | null> => {
    const res = await fetch(`/api/problems/${config.slug}/action/${action}`, {
      method: "POST",
      headers: contestSlug ? { "x-foi-contest": contestSlug } : undefined,
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        typeof (body as { error?: unknown })?.error === "string"
          ? (body as { error: string }).error
          : `请求失败（${res.status}）`;
      setError(message);
      return null;
    }

    setError(null);
    return body as InstanceView;
  };

  // Follows a starting container to ready. The backend answers `spawn` before
  // the image has finished pulling — holding the request open until it had
  // would make a slow pull indistinguishable from a dead backend — so the
  // endpoint arrives here rather than in the spawn response.
  useEffect(() => {
    if (!pulling) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      const next = await call("poll");
      if (cancelled || !next) return;
      if (next.status === "gone") setView(null);
      else setView(next);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulling, config.slug, contestSlug]);

  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      const left = Math.max(0, Math.round((ready.expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setView(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [ready]);

  const spawn = async () => {
    setBusy(true);
    try {
      const next = await call("spawn");
      if (next) setView(next);
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    setBusy(true);
    try {
      // Cleared regardless: a backend that says the instance is already gone
      // has told us the same thing as one that just removed it.
      await call("destroy");
      setView(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-border bg-surface my-6 rounded-lg border">
      <div className="border-border bg-surface-2/50 flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="text-fg text-sm font-semibold">靶机实例</span>
        {ready ? (
          <Badge tone="ok" mono>
            运行中 · {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </Badge>
        ) : pulling ? (
          <Badge tone="warn">启动中</Badge>
        ) : (
          <Badge>未启动</Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {!canAct ? (
          <span className="text-fg-muted text-xs">
            <Link href="/login" className="text-primary hover:underline">
              登录
            </Link>
            后即可启动属于你的靶机实例。
          </span>
        ) : ready ? (
          <>
            <code className="border-border bg-surface-2 text-fg rounded border px-2 py-1 font-mono text-xs">
              {ready.endpoint}
            </code>
            <CopyButton value={ready.endpoint} />
            <Button size="sm" variant="danger" onClick={destroy} disabled={busy}>
              销毁实例
            </Button>
          </>
        ) : pulling ? (
          <>
            <span className="text-fg-muted text-xs">
              正在拉取镜像并启动容器，地址就绪后会出现在这里……
            </span>
            <Button size="sm" variant="danger" onClick={destroy} disabled={busy}>
              取消
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={spawn} disabled={busy}>
              {busy ? "启动中…" : "启动实例"}
            </Button>
            <span className="text-fg-subtle text-xs">
              实例有效期 30 分钟，到期自动回收。
            </span>
          </>
        )}
      </div>

      {error ? (
        <div className="border-border text-err border-t px-4 py-2 text-xs">
          {error}
        </div>
      ) : null}
    </div>
  );
}
