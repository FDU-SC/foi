"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PulseDot } from "@/components/ui/pulse-dot";
import type { BackendQueueStatus, QueueEntry } from "@/lib/backend/board";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 4000;

function makeClock(lang: string, timezone: string) {
  return new Intl.DateTimeFormat(lang, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: timezone,
  });
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "err";
}) {
  return (
    <div>
      <div className="text-fg-muted mb-1 text-xs">{label}</div>
      <span
        className={cn(
          "block text-xl leading-none font-semibold tabular-nums",
          tone === "warn" ? "text-warn" : tone === "err" ? "text-err" : "text-fg",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function QueueRow({
  item,
  index,
  clock,
}: {
  item: QueueEntry;
  index: number;
  clock: Intl.DateTimeFormat;
}) {
  const judging = item.state === "judging";
  return (
    <tr className="align-top">
      <td className="text-fg-subtle py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums">
        {judging ? "▶" : index}
      </td>
      <td className="py-1.5 pr-3">
        <Badge tone={judging ? "info" : "neutral"}>
          {judging ? "评测中" : "排队中"}
        </Badge>
      </td>

      {item.problemSlug ? (
        <td className="text-fg py-1.5 pr-3 font-mono text-[11px]">
          {item.problemSlug}
        </td>
      ) : null}
      <td className="text-fg-subtle py-1.5 pr-3 font-mono text-[11px]">
        {item.submissionId}

        {item.status ? (
          <div className="text-fg-muted mt-0.5 font-sans text-[11px]">
            {item.status}
          </div>
        ) : null}
      </td>
      <td className="text-fg-subtle py-1.5 text-right font-mono text-[11px] tabular-nums">
        {item.runnerId ? (
          <div className="text-fg-subtle mb-0.5">{item.runnerId}</div>
        ) : null}
        {clock.format(new Date(item.claimedAt ?? item.enqueuedAt))}
      </td>
    </tr>
  );
}

function JudgeCard({
  status,
  clock,
}: {
  status: BackendQueueStatus;
  clock: Intl.DateTimeFormat;
}) {
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
          <p className="text-err text-xs">有提交在排队，暂无评测机领取。</p>
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
          <table className="w-full">
            <tbody className="divide-border border-border divide-y border-y">
              {judging.map((item) => (
                <QueueRow
                  key={item.submissionId}
                  item={item}
                  index={0}
                  clock={clock}
                />
              ))}
              {queued.map((item, index) => (
                <QueueRow
                  key={item.submissionId}
                  item={item}
                  index={index + 1}
                  clock={clock}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function JudgeStatusBoard({
  initial,
  lang,
  timezone,
}: {
  initial: BackendQueueStatus[];
  lang: string;
  timezone: string;
}) {
  const clock = makeClock(lang, timezone);
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
    <div className="space-y-6">
      <div className="text-fg-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          共 <span className="text-fg tabular-nums">{statuses.length}</span> 个评测队列
        </span>
        <span>
          在线评测机 <span className="text-fg tabular-nums">{totals.runners}</span>
        </span>
        <span>
          评测中 <span className="text-fg tabular-nums">{totals.judging}</span>
        </span>
        <span>
          排队 <span className="text-fg tabular-nums">{totals.queued}</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <PulseDot className={stale ? "bg-err" : "bg-ok"} />
          {stale ? "连接中断，重试中" : `每 ${POLL_INTERVAL_MS / 1000} 秒刷新`}
        </span>
      </div>

      {statuses.length === 0 ? (
        <p className="text-fg-muted border-border border-y py-10 text-center text-sm">
          暂无评测队列。
        </p>
      ) : (
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          {statuses.map((status) => (
            <JudgeCard key={status.id} status={status} clock={clock} />
          ))}
        </div>
      )}
    </div>
  );
}
