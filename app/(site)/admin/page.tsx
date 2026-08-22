import { count } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { db } from "@/lib/db";
import { contests, problems, submissions, users } from "@/lib/db/schema";
import { listProblems } from "@/lib/problems/registry";
import { listRulesets } from "@/lib/standings/registry";
import { syncProblemsFormAction } from "./actions";

export const metadata: Metadata = { title: "管理" };
export const dynamic = "force-dynamic";

async function countRows(
  table: typeof users | typeof problems | typeof contests | typeof submissions,
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

export default async function AdminPage() {
  const [userCount, problemCount, contestCount, submissionCount] =
    await Promise.all([
      countRows(users),
      countRows(problems),
      countRows(contests),
      countRows(submissions),
    ]);

  const registryCount = listProblems({ includeHidden: true }).length;
  const stats = [
    { label: "用户", value: userCount, href: "/admin/users" },
    { label: "题目（已同步）", value: problemCount, href: "/problems" },
    { label: "比赛", value: contestCount, href: "/admin/contests" },
    { label: "提交", value: submissionCount, href: null },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-fg text-2xl font-bold tracking-tight">管理</h1>

      <div className="grid gap-3 sm:grid-cols-4">
        {stats.map((stat) => {
          const content = (
            <>
              <div className="text-fg-subtle text-xs">{stat.label}</div>
              <div className="text-fg mt-1 font-mono text-2xl font-semibold tabular-nums">
                {stat.value}
              </div>
            </>
          );
          return stat.href ? (
            <Link
              key={stat.label}
              href={stat.href}
              className="border-border bg-surface hover:border-primary/50 rounded-lg border px-4 py-3 transition-colors"
            >
              {content}
            </Link>
          ) : (
            <div
              key={stat.label}
              className="border-border bg-surface rounded-lg border px-4 py-3"
            >
              {content}
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader title="题目同步" />
        <CardBody>
          <p className="text-fg-muted mb-3 text-sm leading-6">
            题目的真源是仓库中的 <code className="font-mono">content/problems</code>
            ，数据库只保留一份镜像用于外键与查询。当前注册表中有{" "}
            <span className="text-fg font-mono">{registryCount}</span> 道题，数据库中有{" "}
            <span className="text-fg font-mono">{problemCount}</span> 道。
          </p>
          <ActionForm action={syncProblemsFormAction} submitLabel="立即同步" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="可用赛制" />
        <CardBody className="space-y-3">
          {listRulesets().map((ruleset) => (
            <div key={ruleset.id}>
              <div className="text-fg text-sm font-medium">
                {ruleset.name}
                <code className="text-fg-subtle ml-2 font-mono text-xs">
                  {ruleset.id}
                </code>
              </div>
              <p className="text-fg-muted text-xs leading-5">
                {ruleset.description}
              </p>
            </div>
          ))}
          <p className="text-fg-subtle border-border border-t pt-3 text-xs leading-5">
            新增赛制：在 <code className="font-mono">lib/standings/rulesets/</code>{" "}
            下新建一个模块，并在同目录的{" "}
            <code className="font-mono">registry.ts</code> 中登记。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
