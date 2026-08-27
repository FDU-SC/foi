import { presentation } from "@/lib/presentation";
import { toPublicConfig, type ProblemConfig } from "@/lib/problems/types";

export function ProblemBadgesSlot({ config }: { config: ProblemConfig }) {
  const Badges = presentation.ProblemBadges;
  if (!Badges) return null;
  return <Badges config={toPublicConfig(config)} />;
}
