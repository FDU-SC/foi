import { facetsFor } from "@/lib/problems/facets";
import { toPublicConfig, type ProblemConfig } from "@/lib/problems/types";
import { viewsFor } from "@/lib/problems/views";

/**
 * The badges beside a problem's title, narrowed to what its contest offers.
 *
 * `offered` is the contest's `facets`. An empty list hides both the badges and
 * the filter bar. Content determines how the selected facets are rendered.
 */
export function ProblemBadgesSlot({
  config,
  offered,
}: {
  config: ProblemConfig;
  offered: readonly string[];
}) {
  const Badges = viewsFor(config.slug).Badges;
  if (!Badges || offered.length === 0) return null;

  return (
    <Badges config={toPublicConfig(config)} facets={facetsFor(config, offered)} />
  );
}
