import type { ReactNode } from "react";
import { getViewer } from "@/auth";
import {
  CatalogueFrame,
  CataloguePanelHeader,
  CatalogueSidebar,
  type CatalogueListItem,
} from "@/components/catalogue/shell";
import { NavigationLinks } from "@/components/site/navigation-links";
import { PageHeader } from "@/components/ui/page";
import { PageTransition } from "@/components/ui/page-transition";
import { allows } from "@/lib/authz/engine";
import { contestFor } from "@/lib/contests/access";
import { catalogueBoardSections, catalogueSlugs } from "@/lib/contests/catalogue";
import { contestPhase, contestStatus } from "@/lib/contests/types";
import { problemsFor } from "@/lib/problems/access";
import { progressFor } from "@/lib/problems/progress";
import { summarizeProgress } from "@/lib/problems/selection";

/**
 * Shared catalogue chrome around the problem list and leaderboard panels.
 * The sidebar, title and tabs stay mounted and still across tab switches; only
 * the body below them fades. Switching inside keeps the previous body until
 * the next one is ready; entering from elsewhere shows the catalogue skeleton.
 */
export async function CatalogueShellView({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  const lists = catalogueSlugs().flatMap((slug) => {
    const view = contestFor(slug, viewer);
    return view ? [{ contest: view.config, preview: view.preview, problems: problemsFor(slug, viewer) }] : [];
  });
  const progress = viewer.authenticated
    ? await progressFor(lists.map(({ contest }) => contest.slug), viewer)
    : null;

  const items: CatalogueListItem[] = lists.map(({ contest, preview, problems }) => {
    const status = contestPhase(contest) === "running" ? null : contestStatus(contest);
    return {
      slug: contest.slug,
      title: contest.title,
      domain: contest.domain ?? null,
      progress: {
        total: problems.length,
        solved: summarizeProgress(problems, progress).solved,
      },
      flags: [
        ...(preview ? [{ label: "未公开", tone: "warn" as const }] : []),
        ...(status ? [status] : []),
      ],
    };
  });

  const canRank = allows("leaderboard.read", null, viewer)
    && (catalogueBoardSections() ?? []).length > 0;

  return (
    <CatalogueFrame>
      <PageHeader title="题库" actions={<NavigationLinks viewer={viewer} location="catalogue" />} />
      {/* No Suspense around the sidebar or tabs: a boundary here can reveal after
          the shell, and the page transition animates the panel across the grid. */}
      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <CatalogueSidebar lists={items} />
        <div className="min-w-0 space-y-3">
          <CataloguePanelHeader lists={items} canRank={canRank} />
          <PageTransition>
            <div className="min-w-0">{children}</div>
          </PageTransition>
        </div>
      </div>
    </CatalogueFrame>
  );
}
