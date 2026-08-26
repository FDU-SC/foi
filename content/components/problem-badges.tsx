import { Badge } from "@/components/ui/badge";
import type { PublicProblemConfig } from "@/lib/problems/types";
import { problemUi } from "./ui-config";

/**
 * What this deployment says about a problem in a list or under its title.
 *
 * The kernel draws this in three places and has no idea what is in it — see
 * `Presentation.ProblemBadges`. What it happens to be here is one difficulty
 * rung, whatever tags the setter wrote, and the mark the problem is out of.
 *
 * The score is last and set apart because it is the only one of the three the
 * kernel also reads: `verdictColumns` uses it as the denominator when a
 * backend reports a bare score, and a contest may override it with `points`
 * for its own round. So it is on the problem rather than in `ui`, and this
 * component reaches for `config.maxScore` while the other two come out of the
 * opaque bag.
 */
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
