import { Badge } from "@/components/ui/badge";

export function TrialBadge({ trial }: { trial: boolean }) {
  if (!trial) return null;

  return (
    <Badge tone="neutral" title="试交照常评测，不计入排行榜">
      试交
    </Badge>
  );
}
