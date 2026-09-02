import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { adminContestsFor } from "@/lib/admin/access";
import { describeAudience } from "@/lib/authz/audience";
import {
  contestHref,
  isCatalogue,
  standingsHref,
} from "@/lib/contests/catalogue";
import { contestStatus } from "@/lib/contests/types";
import { dateFormatter } from "@/lib/format";
import { rulesetFor } from "@/lib/standings/registry";


const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

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

export async function AdminContestsView() {

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
          所有比赛及其配置概览。修改在仓库中完成。
        </p>
      </div>

      {all.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          还没有比赛。
        </p>
      ) : (
        all.map((contest) => {
          const status = contestStatus(contest);
          const ruleset = rulesetFor(contest.leaderboards[0].ruleset.id);

          return (
            <Card key={contest.slug}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={contestHref(contest.slug)}
                      className="hover:text-primary transition-colors"
                    >
                      {contest.title}
                    </Link>
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <Badge>{ruleset?.name ?? "自定义赛制"}</Badge>
                    {isCatalogue(contest.slug) ? (
                      <Badge tone="primary">
                        题库分区{contest.domain ? ` · ${contest.domain}` : ""}
                      </Badge>
                    ) : null}
                    {contest.leaderboards.length > 1 ? (
                      <Badge tone="info">
                        {contest.leaderboards.length} 个排行榜
                      </Badge>
                    ) : null}
                    {contest.visibleTo === undefined ? null : (
                      <Badge tone="warn">
                        可见 {describeAudience(contest.visibleTo)}
                      </Badge>
                    )}
                  </span>
                }
                actions={
                  <Link
                    href={standingsHref(contest.slug)}
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
                          {problem.label
                            ? `${problem.label}. ${problem.slug}`
                            : problem.slug}
                          {problem.points ? ` (${problem.points})` : ""}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}

              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
