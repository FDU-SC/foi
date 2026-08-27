import { toPublicConfig, type ProblemConfig } from "@/lib/problems/types";
import { viewsFor } from "@/lib/problems/views";

export function ProblemBadgesSlot({ config }: { config: ProblemConfig }) {
  const Badges = viewsFor(config.slug).Badges;
  if (!Badges) return null;
  return <Badges config={toPublicConfig(config)} />;
}
