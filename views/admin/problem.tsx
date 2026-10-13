import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { ProblemEditor } from "@/components/admin/problem-editor";
import { ProblemFiles } from "@/components/admin/problem-files";
import { ProblemStatementPreview } from "@/views/admin/problem-statement";
import { Card, CardBody } from "@/components/ui/card";
import { authorize } from "@/lib/authz/engine";
import { catalogueSlugs } from "@/lib/contests/catalogue";
import { allContests } from "@/lib/contests/registry";
import { checkDraft, draftFor, submissionCount } from "@/lib/problems/authoring";

/**
 * The contests a problem can be put in, catalogued ones first.
 *
 * The catalogue order is the order the problem list sidebar uses, so choosing
 * from it here reads the same as it will there; everything else follows by slug.
 */
function contestChoices() {
  const contests = allContests();
  const ranked = new Map(catalogueSlugs().map((slug, index) => [slug, index]));

  return contests
    .map((contest) => ({
      slug: contest.slug,
      title: contest.title,
      domain: contest.domain,
      rank: ranked.get(contest.slug) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || a.slug.localeCompare(b.slug))
    .map(({ slug, title, domain }) => ({ slug, title, domain }));
}

/**
 * One problem's editor.
 *
 * The three steps are on one page in the order they are done: upload the judge
 * files, fill the parameters, write the statement. What is wrong with the draft
 * is worked out here as well, so an author sees it before pressing publish
 * rather than as a refusal afterwards.
 */
export async function AdminProblemView({
  params,
}: PageProps<"/admin/problems/[slug]">) {
  const viewer = await getViewer();
  if (!authorize("problem.author", null, viewer).allow) notFound();

  const { slug } = await params;
  const view = await draftFor(slug);
  if (!view) notFound();

  const files = view.files.map((file) => file.path);
  const issues = checkDraft(view.draft, view.files, { selfSlug: slug });

  // What the delete would take with it, said before it is pressed rather than
  // discovered afterwards.
  const held = await submissionCount(slug);

  return (
    <div className="space-y-4">
      <AdminNav />
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <Link href="/admin/problems" className="hover:text-fg transition-colors">
          题目
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{slug}</span>
      </nav>

      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-fg text-xl font-bold">{view.title}</h1>
        <span className="text-fg-muted font-mono text-xs">{slug}</span>
      </div>

      <Card>
        <CardBody className="space-y-2">
          <h2 className="text-fg text-sm font-semibold">1. 判题文件</h2>
          <ProblemFiles slug={slug} files={files} />
        </CardBody>
      </Card>

      <ProblemEditor
        slug={slug}
        published={view.status === "published"}
        issues={issues}
        contests={contestChoices()}
        files={files}
        submissionsHeld={held}
        draft={{
          title: view.title,
          maxScore: view.draft.maxScore,
          statementMdx: view.statementMdx,
          ui: view.ui,
          viewsPreset: view.viewsPreset,
          script: view.draft.script,
          contestant: view.draft.contestant,
          shell: view.draft.shell,
          memoryLimitMb: view.draft.memoryLimitMb,
          maxFileMb: view.draft.maxFileMb,
          stackLimitMb: view.draft.stackLimitMb,
          addressSpace: view.draft.addressSpace,
          seed: view.draft.seed,
          resultRequired: view.draft.resultRequired,
          cases: view.draft.cases.map((one) => ({
            name: one.name,
            // A stored argv is a list; the field edits it as text.
            argv: one.argv.join(" "),
            threads: one.threads,
            timeLimitMs: one.timeLimitMs,
            maxScore: one.maxScore,
          })),
          contests: view.draft.contests,
        }}
        preview={
          <ProblemStatementPreview
            slug={slug}
            title={view.title}
            maxScore={view.draft.maxScore}
            ui={view.ui}
            viewsPreset={view.viewsPreset}
            contestSlug={view.draft.contests[0]?.slug ?? ""}
            statementMdx={view.statementMdx}
          />
        }
      />
    </div>
  );
}
