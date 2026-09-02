import { facetsFor } from "@/lib/problems/facets";
import { toPublicConfig, type ProblemConfig } from "@/lib/problems/types";
import { viewsFor } from "@/lib/problems/views";

/**
 * The badges beside a problem's title, narrowed to what its contest offers.
 *
 * `offered` is the contest's `facets`, so a round that names no dimension draws
 * nothing here — the same silence its filter bar keeps. Content still decides
 * what a dimension looks like; this only decides which ones reach it.
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
