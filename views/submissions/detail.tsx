import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { ProblemRef } from "@/components/problem/problem-ref";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { PayloadBody, VerdictBody } from "@/components/opaque";
import { RejudgeForm } from "@/components/submissions/rejudge-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { problemBySlug } from "@/lib/problems/registry";
import { submissionFor } from "@/lib/submissions/access";
import { dateFormatter } from "@/lib/format";
import { isRejudgeable } from "@/lib/submissions/rejudge";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "medium" });

export async function SubmissionDetailView({
  params,
}: PageProps<"/submissions/[id]">) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/submissions/${id}`);

  const viewer = viewerFor(user);

  const read = await submissionFor(id, viewer);
  if (!read) notFound();
  const { record: row, view } = read;
  const problem = problemBySlug(row.problemSlug);

  return (
    <div className="min-w-0 space-y-4">
      <nav className="text-fg-subtle flex items-center gap-1.5 text-xs">
        <Link href="/submissions" className="hover:text-fg transition-colors">
          提交记录
        </Link>
        <span>/</span>
        <span className="font-mono">{row.id}</span>
      </nav>

      <header className="border-border flex flex-wrap items-center gap-3 border-b pb-4">
        <h1 className="text-fg text-xl font-bold">
          <ProblemRef
            contestSlug={row.contestSlug}
            slug={row.problemSlug}
            fallbackTitle={problem?.title ?? row.problemSlug}
          />
        </h1>
        <VerdictBadge submission={view} />
        <QueueBadge queue={view.queue} showJudge />
        <span className="text-fg-subtle ml-auto font-mono text-xs">
          {formatter.format(row.createdAt)}
        </span>
        {allows("submission.rejudge", row, viewer) && isRejudgeable(row) ? (
          <RejudgeForm id={row.id} />
        ) : null}
      </header>

      {view.reason ? (
        <p className="text-warn bg-warn-subtle rounded-md px-3 py-2 text-sm">
          {view.reason}
        </p>
      ) : null}

      {view.runnerStatus ? (
        <p className="text-fg-muted bg-surface-2 rounded-md px-3 py-2 font-mono text-xs">
          {view.runnerStatus}
        </p>
      ) : null}

      {view.detail ? (
        <Card>
          <CardHeader title="评测详情" />
          <CardBody>
            <VerdictBody problemSlug={view.problemSlug} detail={view.detail} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="提交内容" />
        <CardBody>
          <PayloadBody problemSlug={row.problemSlug} payload={row.payload} />
        </CardBody>
      </Card>
    </div>
  );
}
