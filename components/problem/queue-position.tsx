import { Badge } from "@/components/ui/badge";
import type { QueuePosition } from "@/lib/submissions/queue-position";

/**
 * Shows where a submission sits in its backend's queue.
 *
 * Renders nothing when there is no position, which now means only one thing:
 * the submission has finished. It used to also cover a judge that truncated or
 * omitted its queue listing, and that case is gone — the queue is a table here,
 * so a waiting submission always has an exact place in it.
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
      {queue.state === "judging" ? (
        <Badge tone="info">正在评测</Badge>
      ) : (
        <Badge tone="warn" mono>
          队列第 {queue.ahead + 1} 位
          {queue.ahead > 0 ? ` · 前面 ${queue.ahead} 个` : ""}
        </Badge>
      )}
      {showJudge ? (
        <span className="text-fg-subtle font-mono text-[11px]">
          {queue.backendId}
        </span>
      ) : null}
    </span>
  );
}
