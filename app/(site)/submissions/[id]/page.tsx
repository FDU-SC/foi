import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { VerdictDetail } from "@/components/problem/verdict-detail";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { locateOne } from "@/lib/judge/queue-lookup";
import { isTerminalState } from "@/lib/judge/types";
import { getProblem } from "@/lib/problems/registry";
import { getSubmissionRow } from "@/lib/submissions/queries";

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

  const row = await getSubmissionRow(id);
  // 404 rather than 403 for other people's submissions: no reason to confirm
  // that an id exists to someone who cannot read it.
  if (!row) notFound();
  if (row.userId !== user.id && user.role !== "admin") notFound();

  const problem = getProblem(row.problemSlug);
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
          <Link
            href={`/problems/${row.problemSlug}`}
            className="hover:text-primary transition-colors"
          >
            {problem?.title ?? row.problemSlug}
          </Link>
        </h1>
        <VerdictBadge state={row.state} verdict={row.verdict} />
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
