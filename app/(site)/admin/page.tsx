import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { loadAdminOverview } from "@/lib/admin/drift";
import { listRoles } from "@/lib/auth/policy";
import { listRulesets } from "@/lib/standings/registry";
import { syncRegistriesFormAction } from "./actions";

export const metadata: Metadata = { title: "管理" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const overview = await loadAdminOverview();

  const stats = [
    { label: "名册", value: overview.rosterSize, href: "/admin/roster" },
    { label: "题目", value: overview.problemCount, href: "/problems" },
    { label: "比赛", value: overview.contestCount, href: "/admin/contests" },
    { label: "提交", value: overview.submissionCount, href: null },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">管理</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          这个页面不改配置。名册、权限、比赛与题目的真源都在仓库里，改动走 pull
          request；这里只负责核对仓库与数据库是否一致，以及签发密码设置码——密码是唯一不能写进仓库的东西。
        </p>
      </div>

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
        <CardHeader title="仓库与数据库一致性" />
        <CardBody className="space-y-3">
          {overview.findings.length === 0 ? (
            <p className="text-fg-muted text-sm leading-6">
              没有发现偏差。注册表中的{" "}
              <span className="text-fg font-mono">{overview.problemCount}</span>{" "}
              道题目和{" "}
              <span className="text-fg font-mono">{overview.contestCount}</span>{" "}
              场比赛都已镜像，名册中的每个人都有可用的凭据。
            </p>
          ) : (
            <ul className="space-y-3">
              {overview.findings.map((finding) => (
                <li key={finding.title}>
                  <div className="flex items-center gap-2">
                    <Badge tone={finding.severity === "warn" ? "warn" : "info"}>
                      {finding.severity === "warn" ? "注意" : "提示"}
                    </Badge>
                    <span className="text-fg text-sm font-medium">
                      {finding.title}
                    </span>
                  </div>
                  <p className="text-fg-muted mt-1 text-xs leading-5">
                    {finding.detail}
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {finding.items.map((item) => (
                      <li key={item}>
                        <Badge mono>{item}</Badge>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <div className="border-border border-t pt-3">
            <p className="text-fg-subtle mb-2 text-xs leading-5">
              镜像表只是外键锚点：数据库里有{" "}
              <span className="font-mono">{overview.mirroredProblems}</span>{" "}
              道题、<span className="font-mono">{overview.mirroredContests}</span>{" "}
              场比赛。启动时会自动同步，这里是手动触发。
            </p>
            <ActionForm
              action={syncRegistriesFormAction}
              submitLabel="立即同步"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="角色与权限" />
        <CardBody className="space-y-3">
          <p className="text-fg-muted text-sm leading-6">
            角色不存在数据库里。下面这张表由{" "}
            <code className="font-mono">lib/auth/policy.ts</code>{" "}
            生成，改权限就是改那个文件——变更会出现在 diff 里。
          </p>
          <div className="border-border overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr className="text-fg-muted text-xs">
                  <th className="border-border border-b px-3 py-2 text-left font-semibold">
                    角色
                  </th>
                  <th className="border-border border-b px-3 py-2 text-left font-semibold">
                    能力
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {listRoles().map(({ id, definition }) => (
                  <tr key={id}>
                    <td className="px-3 py-2 align-top">
                      <div className="text-fg text-sm font-medium">
                        {definition.name}
                      </div>
                      <code className="text-fg-subtle font-mono text-xs">
                        {id}
                      </code>
                    </td>
                    <td className="px-3 py-2">
                      {definition.capabilities.length === 0 ? (
                        <span className="text-fg-subtle text-xs">
                          无额外能力
                        </span>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {definition.capabilities.map((capability) => (
                            <li key={capability}>
                              <Badge mono>{capability}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-fg-subtle mt-1 text-xs leading-5">
                        {definition.description}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
