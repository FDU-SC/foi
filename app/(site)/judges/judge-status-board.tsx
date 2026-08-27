"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { BackendQueueStatus, QueueEntry } from "@/lib/backend/board";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 4000;

const clock = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warn" | "err";
}) {
  return (
    <div>
      <div className="text-fg-subtle mb-1.5 text-[11px] tracking-wide uppercase">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-2xl leading-none font-semibold tabular-nums",
          tone === "warn" ? "text-warn" : tone === "err" ? "text-err" : "text-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function QueueRow({ item, index }: { item: QueueEntry; index: number }) {
  const judging = item.state === "judging";
  return (
    <tr className="hover:bg-surface-2/60 align-top">
      <td className="text-fg-subtle px-3 py-1.5 text-right font-mono text-[11px] tabular-nums">
        {judging ? "▶" : index}
      </td>
      <td className="px-3 py-1.5">
        <Badge tone={judging ? "info" : "neutral"}>
          {judging ? "评测中" : "排队中"}
        </Badge>
      </td>

      {item.problemSlug ? (
        <td className="text-fg px-3 py-1.5 font-mono text-[11px]">
          {item.problemSlug}
        </td>
      ) : null}
      <td className="text-fg-subtle px-3 py-1.5 font-mono text-[11px]">
        {item.submissionId}

        {item.status ? (
          <div className="text-fg-muted mt-0.5 font-sans text-[11px]">
            {item.status}
          </div>
        ) : null}
      </td>
      <td className="text-fg-subtle px-3 py-1.5 text-right font-mono text-[11px] tabular-nums">
        {item.runnerId ? (
          <div className="text-fg-subtle mb-0.5">{item.runnerId}</div>
        ) : null}
        {clock.format(new Date(item.claimedAt ?? item.enqueuedAt))}
      </td>
    </tr>
  );
}

function JudgeCard({ status }: { status: BackendQueueStatus }) {
  const queued = status.items.filter((item) => item.state === "queued");
  const judging = status.items.filter((item) => item.state === "judging");

  const stranded = status.runners === 0 && status.queued > 0;

  return (
    <Card>
      <CardHeader
        className="flex-wrap justify-start gap-2"
        title={<span className="font-mono">{status.id}</span>}
        actions={
          status.runners > 0 ? (
            <Badge tone="ok">{status.runners} 台在线</Badge>
          ) : (
            <Badge tone={status.queued > 0 ? "err" : "neutral"}>无评测机</Badge>
          )
        }
      />

      <CardBody className="space-y-3">
        {status.url ? (
          <div className="text-fg-subtle font-mono text-[11px]">
            {status.url}
          </div>
        ) : null}

        {stranded ? (
          <p className="text-err bg-err-subtle rounded px-2.5 py-1.5 text-xs">
            队列里有等待评测的提交，但最近一分钟没有任何评测机来领活。
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-3">
          <Metric label="在线评测机" value={status.runners} />
          <Metric label="评测中" value={status.judging} />
          <Metric
            label="排队等待"
            value={status.queued}
            tone={stranded ? "err" : status.queued > 0 ? "warn" : undefined}
          />
        </div>

        {status.items.length > 0 ? (
          <div className="border-border overflow-hidden rounded border">
            <table className="w-full">
              <tbody className="divide-border divide-y">
                {judging.map((item) => (
                  <QueueRow key={item.submissionId} item={item} index={0} />
                ))}
                {queued.map((item, index) => (
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
      </CardBody>
    </Card>
  );
}

export function JudgeStatusBoard({
  initial,
}: {
  initial: BackendQueueStatus[];
}) {
  const [statuses, setStatuses] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/judges/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as BackendQueueStatus[];
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

  const totals = statuses.reduce(
    (sum, status) => ({
      queued: sum.queued + status.queued,
      judging: sum.judging + status.judging,
      runners: sum.runners + status.runners,
    }),
    { queued: 0, judging: 0, runners: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="text-fg-subtle flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          共 <span className="text-fg font-mono">{statuses.length}</span> 个题目后端
        </span>
        <span>
          在线评测机 <span className="text-fg font-mono">{totals.runners}</span>
        </span>
        <span>
          评测中 <span className="text-fg font-mono">{totals.judging}</span>
        </span>
        <span>
          排队 <span className="text-fg font-mono">{totals.queued}</span>
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
          content/backends.ts 中还没有登记题目后端。
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
