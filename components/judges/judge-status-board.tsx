"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LAYOUT_SPRING } from "@/components/ui/motion";
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
      <div className="text-fg-subtle mb-1.5 text-[11px] tracking-wide uppercase">
        {label}
      </div>
      <AnimatedNumber
        value={value}
        className={cn(
          "block font-mono text-2xl leading-none font-semibold tabular-nums",
          tone === "warn" ? "text-warn" : tone === "err" ? "text-err" : "text-fg",
        )}
      />
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
    <motion.tr
      // Keyed by submission id, so a job moving up the queue slides there.
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={LAYOUT_SPRING}
      className="hover:bg-surface-2/60 align-top"
    >
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
    </motion.tr>
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
                <AnimatePresence initial={false}>
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
                </AnimatePresence>
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
    <div className="space-y-4">
      <div className="text-fg-subtle flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          共 <span className="text-fg font-mono">{statuses.length}</span> 个题目后端
        </span>
        <span>
          在线评测机{" "}
          <AnimatedNumber
            value={totals.runners}
            className="text-fg font-mono tabular-nums"
          />
        </span>
        <span>
          评测中{" "}
          <AnimatedNumber
            value={totals.judging}
            className="text-fg font-mono tabular-nums"
          />
        </span>
        <span>
          排队{" "}
          <AnimatedNumber
            value={totals.queued}
            className="text-fg font-mono tabular-nums"
          />
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <PulseDot active={!stale} className={stale ? "bg-err" : "bg-ok"} />
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
            <JudgeCard key={status.id} status={status} clock={clock} />
          ))}
        </div>
      )}
    </div>
  );
}
