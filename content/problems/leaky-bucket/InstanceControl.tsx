"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";

const LIFETIME_SECONDS = 30 * 60;

interface Instance {
  endpoint: string;
  expiresAt: number;
}

/**
 * Per-problem infrastructure control.
 *
 * Spawning and destroying containers is not the OJ's job — this component
 * talks to whatever service the problem author runs. Point `INSTANCE_API` at
 * that service; the local simulation below only exists so the demo problem
 * works without external infrastructure.
 */
const INSTANCE_API = process.env.NEXT_PUBLIC_LEAKY_BUCKET_API ?? null;

export function InstanceControl() {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!instance) return;
    const tick = () => {
      const left = Math.max(0, Math.round((instance.expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setInstance(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [instance]);

  const spawn = async () => {
    setBusy(true);
    try {
      if (INSTANCE_API) {
        const res = await fetch(`${INSTANCE_API}/spawn`, { method: "POST" });
        const data = (await res.json()) as Instance;
        setInstance(data);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const port = 30000 + Math.floor(Math.random() * 5000);
        setInstance({
          endpoint: `http://chal.foi.internal:${port}`,
          expiresAt: Date.now() + LIFETIME_SECONDS * 1000,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    setBusy(true);
    try {
      if (INSTANCE_API) {
        await fetch(`${INSTANCE_API}/destroy`, { method: "POST" });
      }
      setInstance(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-border bg-surface my-6 rounded-lg border">
      <div className="border-border bg-surface-2/50 flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="text-fg text-sm font-semibold">靶机实例</span>
        {instance ? (
          <Badge tone="ok" mono>
            运行中 · {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </Badge>
        ) : (
          <Badge>未启动</Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {instance ? (
          <>
            <code className="border-border bg-surface-2 text-fg rounded border px-2 py-1 font-mono text-xs">
              {instance.endpoint}
            </code>
            <CopyButton value={instance.endpoint} />
            <Button size="sm" variant="danger" onClick={destroy} disabled={busy}>
              销毁实例
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
    </div>
  );
}
