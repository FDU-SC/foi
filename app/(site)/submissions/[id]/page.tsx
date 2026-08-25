import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { ProblemRef } from "@/components/problem/problem-ref";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { PayloadBody } from "@/components/opaque/payload-body";
import { VerdictBody } from "@/components/opaque/verdict-body";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { locateOne } from "@/lib/backend/queue-lookup";
import { failureReason, isSettled } from "@/lib/backend/types";
import { problemBySlug } from "@/lib/problems/registry";
import { submissionFor } from "@/lib/submissions/access";
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

  // Undefined covers both "no such submission" and "not yours": no reason to
  // confirm an id exists to somebody who cannot read it.
  const row = await submissionFor(id, viewer);
  if (!row) notFound();

  // Raw on purpose: this row is proof the viewer already interacted with the
  // problem, and access to the row is checked above. Withholding the title
  // here would only blank out a page the reader is entitled to — the gate is
  // about problems nobody has seen yet, not ones already submitted to.
  const problem = problemBySlug(row.problemSlug);
  const reason = failureReason(row);
  const queue = isSettled(row.state) ? null : await locateOne(row.id);

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

      {/*
        Through `failureReason` rather than straight off `row.error`, which is
        the same judgement `toView` makes for the list and the submit panel. The
        column also carries text on rows that are still in flight — a runner's
        last words before the reaper took the job off it — and printing that
        here would announce a failure beside a spinner. It appears once the row
        really is `disrupted`.

        Amber rather than red, matching the badge: nothing here is the
        submitter's doing, and the colour that says "you got this wrong" is
        reserved for verdicts that mean it.
      */}
      {reason ? (
        <p className="text-warn bg-warn-subtle rounded-md px-3 py-2 text-sm">
          {reason}
        </p>
      ) : null}

      {viewer.can("submission.rejudge") && isRejudgeable(row) ? (
        <RejudgeForm id={row.id} />
      ) : null}

      {/*
        The holder's own words, while it is still holding. Rendered verbatim and
        interpreted not at all — "拉取镜像" and "测试点 3/10" are equally valid
        and the kernel knows what neither means.
      */}
      {row.runnerStatus && !isSettled(row.state) ? (
        <p className="text-fg-muted bg-surface-2 rounded-md px-3 py-2 font-mono text-xs">
          {row.runnerStatus}
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

      {/*
        Both of these are opaque to the kernel, so both go through a slot a
        deployment may fill — see `lib/presentation/types.ts`. Unfilled, they
        render as the JSON they are.
      */}
      <Card>
        <CardHeader title="提交内容" />
        <CardBody>
          <PayloadBody problemSlug={row.problemSlug} payload={row.payload} />
        </CardBody>
      </Card>
    </div>
  );
}
