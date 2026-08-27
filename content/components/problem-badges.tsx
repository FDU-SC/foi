import { Badge } from "@/components/ui/badge";
import type { PublicProblemConfig } from "@/lib/problems/types";
import { problemUi } from "./ui-config";

export function ProblemBadges({ config }: { config: PublicProblemConfig }) {
  const ui = problemUi(config);

  return (
    <>
      {ui.difficulty ? <Badge tone="primary">{ui.difficulty}</Badge> : null}
      {ui.tags.map((tag) => (
        <Badge key={tag}>{tag}</Badge>
      ))}
      <span className="text-fg-subtle ml-auto font-mono text-xs tabular-nums">
        满分 {config.maxScore}
      </span>
    </>
  );
}
