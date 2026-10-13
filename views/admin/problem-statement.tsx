import { ProblemProvider } from "@/components/problem/problem-context";
import { log } from "@/lib/log";
import { statementComponent } from "@/lib/problems/statement";
import type { PublicProblemConfig } from "@/lib/problems/types";

/**
 * The statement editor's preview, rendered in the page rather than framed.
 *
 * It goes through the same compile and the same component set the published
 * problem page does, which is the whole point: a preview built out of a second,
 * similar-looking pipeline is how a preview and a page come to disagree.
 *
 * It is inline because the platform refuses to be framed — `next.config.ts` sets
 * `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every path, including
 * this one, and a browser renders that refusal as a dead frame. Framing it would
 * have meant carving an exception into those headers for one admin route.
 *
 * A statement that will not compile is reported here rather than thrown: the
 * preview is one panel of an editing page, and taking the page down would hide
 * both the text the author has to fix and everything else on it. The compile
 * error is the useful part — it names what is wrong with the text.
 *
 * The providers are the ones a problem page mounts, so the statement's own submit
 * panel renders as itself. It is told it may not submit: a preview that could
 * create a real judged submission is not a preview.
 */
export async function ProblemStatementPreview({
  slug,
  title,
  maxScore,
  ui,
  viewsPreset,
  contestSlug,
  statementMdx,
}: {
  slug: string;
  title: string;
  maxScore: number;
  ui: Record<string, unknown>;
  viewsPreset: string;
  contestSlug: string;
  statementMdx: string;
}) {
  const statement = statementMdx.trim();
  if (statement.length === 0) {
    return <p className="text-fg-muted text-sm">题面还是空的。</p>;
  }

  let Statement: Awaited<ReturnType<typeof statementComponent>>;
  try {
    Statement = await statementComponent(statement);
  } catch (error) {
    log.warn({ slug, err: error }, "题面无法编译，预览里说明原因");
    return (
      <div className="text-sm">
        <p className="text-err font-medium">这段题面无法渲染。</p>
        <p className="text-fg-subtle mt-1">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    );
  }

  // No backend: the preview judges nothing, and which backend judges a problem is
  // the deployment's to name, not a view's.
  const config: PublicProblemConfig = {
    slug,
    title,
    maxScore,
    submit: {},
    ui,
    viewsPreset,
  };

  return (
    <div className="min-w-0">
      <ProblemProvider
        value={{
          config,
          contestSlug,
          permissions: {
            submit: {
              allowed: false,
              reason: { code: "preview", message: "这是预览，提交按钮不会真的提交。" },
            },
            actions: {},
          },
        }}
      >
        <Statement />
      </ProblemProvider>
    </div>
  );
}
