import { Badge } from "@/components/ui/badge";
import type { QueuePosition } from "@/lib/judge/queue-lookup";

/**
 * Shows where a submission sits in its judge's queue.
 *
 * Renders nothing when the position is unknown — a judge may truncate or omit
 * its queue listing, and in that case the plain state badge already says the
 * submission is waiting.
 */
export function QueueBadge({
  queue,
  showJudge = false,
}: {
  queue?: QueuePosition | null;
  showJudge?: boolean;
}) {
  if (!queue) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      {queue.state === "running" ? (
        <Badge tone="info">正在评测</Badge>
      ) : (
        <Badge tone="warn" mono>
          队列第 {queue.ahead + 1} 位
          {queue.ahead > 0 ? ` · 前面 ${queue.ahead} 个` : ""}
        </Badge>
      )}
      {showJudge ? (
        <span className="text-fg-subtle font-mono text-[11px]">
          {queue.judgeId}
        </span>
      ) : null}
    </span>
  );
}
