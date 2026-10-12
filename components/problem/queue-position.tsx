import { Badge } from "@/components/ui/badge";
import type { QueuePosition } from "@/lib/submissions/queue-position";

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
