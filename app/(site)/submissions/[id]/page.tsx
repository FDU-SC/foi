import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/permissions/viewer";
import { ProblemRef } from "@/components/problem/problem-ref";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { PayloadBody, VerdictBody } from "@/components/opaque";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { failureReason, isSettled } from "@/lib/backend/types";
import { problemBySlug } from "@/lib/problems/registry";
import { submissionFor } from "@/lib/submissions/access";
import { locateOne } from "@/lib/submissions/queue-position";
import { getRunnerStatus } from "@/lib/submissions/queries";
import { isRejudgeable } from "@/lib/submissions/rejudge";
import { RejudgeForm } from "./rejudge-form";

export const metadata: Metadata = { title: "提交详情" };
export const dynamic = "force-dynamic";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
});

export default async function SubmissionPage({
  params,
}: PageProps<"/submissions/[id]">) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/submissions/${id}`);

  const viewer = viewerFor(user);

  const row = await submissionFor(id, viewer);
  if (!row) notFound();

  const problem = problemBySlug(row.problemSlug);
  const reason = failureReason(row);
  const settled = isSettled(row.state);
  const [queue, runnerStatus] = settled
    ? [null, null]
    : await Promise.all([locateOne(row.id), getRunnerStatus(row.id)]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
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
            slug={row.problemSlug}
            fallbackTitle={problem?.title ?? row.problemSlug}
          />
        </h1>
        <VerdictBadge submission={row} />
        <QueueBadge queue={queue} showJudge />
        <span className="text-fg-subtle ml-auto font-mono text-xs">
          {formatter.format(row.createdAt)}
        </span>
      </header>

      {reason ? (
        <p className="text-warn bg-warn-subtle rounded-md px-3 py-2 text-sm">
          {reason}
        </p>
      ) : null}

      {viewer.can("submission.rejudge") && isRejudgeable(row) ? (
        <RejudgeForm id={row.id} />
      ) : null}

      {runnerStatus && !settled ? (
        <p className="text-fg-muted bg-surface-2 rounded-md px-3 py-2 font-mono text-xs">
          {runnerStatus}
        </p>
      ) : null}

      {row.verdict ? (
        <Card>
          <CardHeader title="评测详情" />
          <CardBody>
            <VerdictBody problemSlug={row.problemSlug} verdict={row.verdict} />
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
