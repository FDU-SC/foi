import { presentation } from "@/lib/presentation";
import { toPublicConfig, type ProblemConfig } from "@/lib/problems/types";

/**
 * Whatever this deployment says about a problem in passing: its difficulty,
 * its tags, what it is worth, or nothing at all.
 *
 * A wrapper around one optional slot, and it exists for the projection rather
 * than for the null check. The three pages that draw this hold a full
 * `ProblemConfig`, `backend.config` and all, and the slot is a component a
 * deployment writes — quite possibly a client one. Handing it the raw config
 * would put testdata paths and literal answers into a flight payload at three
 * call sites, each of which would have to remember `toPublicConfig` on its
 * own. Remembering it here means they cannot forget.
 *
 * Renders nothing when the deployment declares no slot, which is a legal and
 * unremarkable deployment: a problem is then listed by slug and title.
 */
export function ProblemBadges({ config }: { config: ProblemConfig }) {
  const Badges = presentation.ProblemBadges;
  if (!Badges) return null;
  return <Badges config={toPublicConfig(config)} />;
}
