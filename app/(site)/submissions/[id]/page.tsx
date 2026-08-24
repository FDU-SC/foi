import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { ProblemRef } from "@/components/problem/problem-ref";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { VerdictDetail } from "@/components/problem/verdict-detail";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { locateOne } from "@/lib/backend/queue-lookup";
import { isTerminalState } from "@/lib/backend/types";
import { problemBySlug } from "@/lib/problems/registry";
import { submissionFor } from "@/lib/submissions/access";

export const metadata: Metadata = { title: "提交详情" };
export const dynamic = "force-dynamic";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
});

/** Pulls a readable source string out of the payload shapes FOI ships with. */
function extractSource(payload: unknown): { text: string; label: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  if (typeof record.source === "string") {
    const language =
      typeof record.language === "string" ? record.language : "代码";
    return { text: record.source, label: language };
  }
  if (typeof record.flag === "string") return { text: record.flag, label: "flag" };
  if (typeof record.text === "string") return { text: record.text, label: "文本" };
  return null;
}

export default async function SubmissionPage({
  params,
}: PageProps<"/submissions/[id]">) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/submissions/${id}`);

  // Undefined covers both "no such submission" and "not yours": no reason to
  // confirm an id exists to somebody who cannot read it.
  const row = await submissionFor(id, viewerFor(user));
  if (!row) notFound();

  // Raw on purpose: this row is proof the viewer already interacted with the
  // problem, and access to the row is checked above. Withholding the title
  // here would only blank out a page the reader is entitled to — the gate is
  // about problems nobody has seen yet, not ones already submitted to.
  const problem = problemBySlug(row.problemSlug);
  const source = extractSource(row.payload);
  const queue = isTerminalState(row.state) ? null : await locateOne(row.id);

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

      {row.error ? (
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm">
          {row.error}
        </p>
      ) : null}

      {row.verdict ? (
        <Card>
          <CardHeader title="评测详情" />
          <CardBody>
            <VerdictDetail verdict={row.verdict} />
          </CardBody>
        </Card>
      ) : null}

      {source ? (
        <Card>
          <CardHeader title={`提交内容 · ${source.label}`} />
          <pre className="text-fg overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
            {source.text}
          </pre>
        </Card>
      ) : (
        <Card>
          <CardHeader title="提交内容" />
          <pre className="text-fg-muted overflow-x-auto px-4 py-3 font-mono text-xs">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}
