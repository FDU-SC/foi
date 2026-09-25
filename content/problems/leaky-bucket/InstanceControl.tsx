"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Permission } from "@/lib/authz/adapters";
import { useProblem } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/content/_shared/mdx/copy-button";

type InstanceView =
  | { status: "pulling"; instanceId: string }
  | { status: "ready"; instanceId: string; endpoint: string; expiresAt: number }
  | { status: "gone" };

const POLL_INTERVAL_MS = 1500;

function PermissionNotice({ permission }: { permission: Permission | undefined }) {
  if (permission?.allowed) return null;
  return <span className="text-fg-muted text-xs">
    {permission?.reason.code === "unauthenticated"
      ? <><Link href="/login" className="text-primary hover:underline">登录</Link>后可执行此操作。</>
      : permission?.reason.message ?? "这道题未提供此操作。"}
  </span>;
}

export function InstanceControl() {
  const { config, contestSlug, permissions } = useProblem();
  const [view, setView] = useState<InstanceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [pollDenied, setPollDenied] = useState(false);
  const { spawn: spawnPermission, poll: pollPermission, destroy: destroyPermission } = permissions.actions;

  const ready = view?.status === "ready" ? view : null;
  const pulling = view?.status === "pulling";

  const call = useCallback(async (action: "spawn" | "poll" | "destroy", signal?: AbortSignal): Promise<InstanceView | null> => {
    const permission = permissions.actions[action];
    if (!permission?.allowed) {
      setError(permission?.reason.message ?? "这道题未提供此操作。");
      return null;
    }
    try {
      const res = await fetch(
        `/api/contests/${contestSlug}/problems/${config.slug}/action/${action}`,
        { method: "POST", signal },
      );
      const body = await res.json().catch(() => null);
      if (signal?.aborted) return null;
      if (!res.ok) {
        const message = typeof body?.error === "string" ? body.error : `请求失败（${res.status}）`;
        setError(message);
        if (action === "poll" && [401, 403, 404].includes(res.status)) setPollDenied(true);
        return null;
      }
      setError(null);
      return action === "destroy" ? { status: "gone" } : body as InstanceView;
    } catch {
      if (!signal?.aborted) setError("无法连接题目后端");
      return null;
    }
  }, [config.slug, contestSlug, permissions.actions]);

  useEffect(() => {
    if (!pulling || !pollPermission?.allowed || pollDenied) return;
    const request = new AbortController();
    const timer = setInterval(async () => {
      const next = await call("poll", request.signal);
      if (request.signal.aborted || !next) return;
      if (next.status === "gone") setView(null);
      else setView(next);
    }, POLL_INTERVAL_MS);
    return () => {
      request.abort();
      clearInterval(timer);
    };
  }, [pulling, pollPermission?.allowed, pollDenied, call]);

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
      if (next) {
        setPollDenied(false);
        setView(next);
      }
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    setBusy(true);
    try {
      const next = await call("destroy");
      if (next) setView(null);
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
        {ready ? (
          <>
            <code className="border-border bg-surface-2 text-fg rounded border px-2 py-1 font-mono text-xs">
              {ready.endpoint}
            </code>
            <CopyButton value={ready.endpoint} />
            <Button size="sm" variant="danger" onClick={destroy} disabled={busy || !destroyPermission?.allowed}>
              销毁实例
            </Button>
            <PermissionNotice permission={destroyPermission} />
          </>
        ) : pulling ? (
          <>
            <span className="text-fg-muted text-xs">
              实例正在启动。
            </span>
            <Button size="sm" variant="danger" onClick={destroy} disabled={busy || !destroyPermission?.allowed}>
              取消
            </Button>
            <PermissionNotice permission={destroyPermission} />
            <PermissionNotice permission={pollPermission} />
          </>
        ) : !spawnPermission?.allowed ? (
          <PermissionNotice permission={spawnPermission} />
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={spawn} disabled={busy}>
              {busy ? "启动中…" : "启动实例"}
            </Button>
            <span className="text-fg-subtle text-xs">
              有效期 30 分钟。
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
