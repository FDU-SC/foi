"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useProblem } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/content/_shared/mdx/copy-button";

type InstanceView =
  | { status: "pulling"; instanceId: string }
  | { status: "ready"; instanceId: string; endpoint: string; expiresAt: number }
  | { status: "gone" };

const POLL_INTERVAL_MS = 1500;

export function InstanceControl() {
  const { config, contestSlug, canAct, blocked } = useProblem();
  const [view, setView] = useState<InstanceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  const ready = view?.status === "ready" ? view : null;
  const pulling = view?.status === "pulling";

  const call = async (action: string): Promise<InstanceView | null> => {
    const res = await fetch(
      `/api/contests/${contestSlug}/problems/${config.slug}/action/${action}`,
      { method: "POST" },
    );

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
            {blocked?.code === "unauthenticated" ? (
              <>
                <Link href="/login" className="text-primary hover:underline">
                  登录
                </Link>
                后即可启动属于你的靶机实例。
              </>
            ) : (
              (blocked?.message ?? "这道题现在不能启动靶机实例。")
            )}
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
