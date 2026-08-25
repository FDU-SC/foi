import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { adminContestsFor } from "@/lib/admin/access";
import { describeAudience } from "@/lib/auth/audience";
import { contestPhase, PHASE_LABEL, PHASE_TONE } from "@/lib/contests/types";
import { rulesetFor } from "@/lib/standings/registry";

export const metadata: Metadata = { title: "比赛管理" };
export const dynamic = "force-dynamic";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function participantsLabel(
  mode: "open" | "group" | "list",
  resolved: number | null,
): string {
  switch (mode) {
    case "open":
      return "开放（谁提交谁上榜）";
    case "group":
      return `按用户组，${resolved} 人`;
    case "list":
      return `按名单，${resolved} 人`;
  }
}

export default async function AdminContestsPage() {
  // Entry lists come from the account table, so the access layer resolves them
  // up front rather than leaving a query inside the render loop.
  const rows = await adminContestsFor(await getViewer());
  if (!rows) notFound();

  const all = rows.map((row) => row.config);
  const entrantCounts = new Map(
    rows.map((row) => [row.config.slug, row.entrants] as const),
  );

  return (
    <div className="space-y-6">
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>比赛</span>
      </nav>

      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">比赛</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          比赛定义在{" "}
          <code className="font-mono">content/contests/&lt;slug&gt;/contest.ts</code>
          ：时间、赛制、题单、参赛范围都在那一个文件里。新建一场比赛就是新建一个目录，改时间就是改一行——两者都会经过 code
          review，也都能回滚。
        </p>
      </div>

      {all.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          还没有比赛。在{" "}
          <code className="font-mono">content/contests/</code>{" "}
          下新建一个目录，写一份{" "}
          <code className="font-mono">contest.ts</code> 即可。
        </p>
      ) : (
        all.map((contest) => {
          const phase = contestPhase(contest);
          const ruleset = rulesetFor(contest.slug, contest.ruleset.id);

          return (
            <Card key={contest.slug}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/contests/${contest.slug}`}
                      className="hover:text-primary transition-colors"
                    >
                      {contest.title}
                    </Link>
                    <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
                    <Badge>{ruleset?.name ?? "自定义赛制"}</Badge>
                    {contest.ruleset.id ? null : (
                      <Badge tone="info" title="ruleset.tsx 与这场比赛一起冻结在 git 里，不随共享模板演进">
                        自带
                      </Badge>
                    )}
                    {contest.visibleTo === undefined ? null : (
                      <Badge tone="warn">
                        可见 {describeAudience(contest.visibleTo)}
                      </Badge>
                    )}
                  </span>
                }
                actions={
                  <Link
                    href={`/contests/${contest.slug}/standings`}
                    className="text-fg-subtle hover:text-primary text-xs transition-colors"
                  >
                    排行榜
                  </Link>
                }
              />
              <CardBody className="space-y-3">
                <dl className="text-fg-subtle flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
                  <div>开始 {formatter.format(contest.startsAt)}</div>
                  <div>结束 {formatter.format(contest.endsAt)}</div>
                  {contest.freezeAt ? (
                    <div>封榜 {formatter.format(contest.freezeAt)}</div>
                  ) : null}
                  <div>
                    参赛{" "}
                    {participantsLabel(
                      contest.participants.mode,
                      entrantCounts.get(contest.slug) ?? null,
                    )}
                  </div>
                </dl>

                {contest.problems.length === 0 ? (
                  <p className="text-fg-subtle text-xs">尚未添加题目。</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {contest.problems.map((problem) => (
                      <li key={problem.slug}>
                        <Badge tone="primary" mono>
                          {problem.label}. {problem.slug}
                          {problem.points ? ` (${problem.points})` : ""}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-fg-subtle border-border border-t pt-3 text-xs leading-5">
                  编辑{" "}
                  <code className="font-mono">
                    content/contests/{contest.slug}/contest.ts
                  </code>
                </p>
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
