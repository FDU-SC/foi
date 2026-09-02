import { Badge } from "@/components/ui/badge";
import type { PublicProblemConfig } from "@/lib/problems/types";
import type { ProblemFacet } from "@/lib/problems/views";

/** Which dimension gets the accent. Everything else reads as a plain label. */
const ACCENTED = "difficulty";

export function ProblemBadges({
  config,
  facets,
}: {
  config: PublicProblemConfig;
  facets: ProblemFacet[];
}) {
  return (
    <>
      {facets.flatMap((facet) =>
        facet.values.map((value) => (
          <Badge
            key={`${facet.key}:${value}`}
            tone={facet.key === ACCENTED ? "primary" : "neutral"}
          >
            {value}
          </Badge>
        )),
      )}
      <span className="text-fg-subtle ml-auto font-mono text-xs tabular-nums">
        满分 {config.maxScore}
      </span>
    </>
  );
}
