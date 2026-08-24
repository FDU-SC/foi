"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { QUEUE_HEALTH_PRESETS, type QueueItem } from "@/lib/backend/types";
import type { JudgeQueueStatus } from "@/lib/backend/client";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 4000;
const MAX_SLOTS_DRAWN = 24;

// Fixed locale and time zone so the server and client render the same string.
const clock = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

function Slots({ capacity, running }: { capacity: number; running: number }) {
  const drawn = Math.min(capacity, MAX_SLOTS_DRAWN);
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: drawn }, (_, index) => (
        <span
          key={index}
          className={cn(
            "size-2.5 rounded-sm",
            index < running ? "bg-ok" : "bg-surface-3",
          )}
        />
      ))}
      {capacity > drawn ? (
        <span className="text-fg-subtle text-[10px]">+{capacity - drawn}</span>
      ) : null}
      {capacity === 0 ? (
        <span className="text-fg-subtle text-xs">未上报容量</span>
      ) : null}
    </div>
  );
}

function formatMillis(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warn";
}) {
  return (
    <div>
      <div className="text-fg-subtle mb-1.5 text-[11px] tracking-wide uppercase">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-2xl leading-none font-semibold tabular-nums",
          tone === "warn" ? "text-warn" : "text-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function QueueRow({ item, index }: { item: QueueItem; index: number }) {
  const running = item.state === "running";
  return (
    <tr className="hover:bg-surface-2/60">
      <td className="text-fg-subtle px-3 py-1.5 text-right font-mono text-[11px] tabular-nums">
        {running ? "▶" : index}
      </td>
      <td className="px-3 py-1.5">
        <Badge tone={running ? "info" : "neutral"}>
          {running ? "评测中" : "排队中"}
        </Badge>
      </td>
      {/* Absent for non-admins: it would reveal who is working on what. */}
      {item.problemSlug ? (
        <td className="text-fg px-3 py-1.5 font-mono text-[11px]">
          {item.problemSlug}
        </td>
      ) : null}
      <td className="text-fg-subtle px-3 py-1.5 font-mono text-[11px]">
        {item.submissionId}
      </td>
      <td className="text-fg-subtle px-3 py-1.5 text-right font-mono text-[11px] tabular-nums">
        {clock.format(new Date(item.startedAt ?? item.enqueuedAt))}
      </td>
    </tr>
  );
}

function JudgeCard({ status }: { status: JudgeQueueStatus }) {
  const { queue } = status;
  const preset = queue ? QUEUE_HEALTH_PRESETS[queue.health] : null;
  const pendingItems = queue?.items.filter((i) => i.state === "pending") ?? [];
  const runningItems = queue?.items.filter((i) => i.state === "running") ?? [];

  return (
    <div className="border-border bg-surface overflow-hidden rounded-lg border">
      <div className="border-border bg-surface-2/50 flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <span className="text-fg font-mono text-sm font-semibold">
          {status.id}
        </span>
        {status.online && preset ? (
          <Badge tone={preset.tone}>{preset.label}</Badge>
        ) : (
          <Badge tone="err">离线</Badge>
        )}
        {queue?.version ? (
          <span className="text-fg-subtle font-mono text-[11px]">
            v{queue.version}
          </span>
        ) : null}
        <span className="text-fg-subtle ml-auto font-mono text-[11px] tabular-nums">
          {status.latencyMs !== null ? `${status.latencyMs}ms` : "—"}
        </span>
      </div>

      <div className="space-y-3 px-4 py-3">
        {status.url ? (
          <div className="text-fg-subtle font-mono text-[11px]">
            {status.url}
          </div>
        ) : null}

        {status.error ? (
          <p className="text-err bg-err-subtle rounded px-2.5 py-1.5 text-xs">
            {status.error}
          </p>
        ) : null}

        {queue ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="text-fg-subtle mb-1.5 text-[11px] tracking-wide uppercase">
                  并发槽位
                </div>
                <Slots capacity={queue.capacity} running={queue.running} />
                <div className="text-fg mt-1.5 font-mono text-xs tabular-nums">
                  {queue.running} / {queue.capacity}
                </div>
              </div>

              <Metric
                label="排队等待"
                value={queue.pending}
                tone={queue.pending > 0 ? "warn" : undefined}
              />
              <Metric label="已完成" value={queue.completed ?? "—"} />
              <Metric
                label="平均耗时"
                value={
                  queue.avgDurationMs !== undefined
                    ? formatMillis(queue.avgDurationMs)
                    : "—"
                }
              />
            </div>

            {queue.items.length > 0 ? (
              <div className="border-border overflow-hidden rounded border">
                <table className="w-full">
                  <tbody className="divide-border divide-y">
                    {runningItems.map((item) => (
                      <QueueRow key={item.submissionId} item={item} index={0} />
                    ))}
                    {pendingItems.map((item, index) => (
                      <QueueRow
                        key={item.submissionId}
                        item={item}
                        index={index + 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function JudgeStatusBoard({
  initial,
}: {
  initial: JudgeQueueStatus[];
}) {
  const [statuses, setStatuses] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/judges/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as JudgeQueueStatus[];
        if (cancelled) return;
        setStatuses(next);
        setStale(false);
      } catch {
        if (!cancelled) setStale(true);
      }
    };

    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const totalPending = statuses.reduce(
    (sum, status) => sum + (status.queue?.pending ?? 0),
    0,
  );
  const totalRunning = statuses.reduce(
    (sum, status) => sum + (status.queue?.running ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="text-fg-subtle flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          共 <span className="text-fg font-mono">{statuses.length}</span> 台判题机
        </span>
        <span>
          评测中 <span className="text-fg font-mono">{totalRunning}</span>
        </span>
        <span>
          排队 <span className="text-fg font-mono">{totalPending}</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              stale ? "bg-err" : "bg-ok animate-pulse",
            )}
          />
          {stale ? "连接中断，重试中" : `每 ${POLL_INTERVAL_MS / 1000} 秒刷新`}
        </span>
      </div>

      {statuses.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          backends.config.ts 中还没有登记题目后端。
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {statuses.map((status) => (
            <JudgeCard key={status.id} status={status} />
          ))}
        </div>
      )}
    </div>
  );
}
