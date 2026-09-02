import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { adminOverviewFor } from "@/lib/admin/access";
import { listGroups } from "@/lib/authz/groups";
import { policyMatrix } from "@/lib/authz/introspect";
import { listRulesets } from "@/lib/standings/registry";

export async function AdminOverviewView() {
  const viewer = await getViewer();
  const overview = await adminOverviewFor(viewer);
  if (!overview) notFound();

  const stats = [
    { label: "账号", value: overview.accountCount, href: "/admin/accounts" },
    { label: "题目", value: overview.problemCount, href: "/admin/contests" },
    { label: "比赛", value: overview.contestCount, href: "/admin/contests" },
    { label: "提交", value: overview.submissionCount, href: null },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">管理</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          查看平台运行概况。配置变更在仓库中完成，这里可以补发重置密码邮件和管理账号状态。
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
              一切正常，未发现配置问题。
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
            <p className="text-fg-subtle text-xs leading-5">
              数据库中有{" "}
              <span className="font-mono">{overview.mirroredProblems}</span>{" "}
              道题、<span className="font-mono">{overview.mirroredContests}</span>{" "}
              场比赛的提交记录，仓库共{" "}
              <span className="font-mono">{overview.problemCount}</span> 道题、
              <span className="font-mono">{overview.contestCount}</span>{" "}
              场比赛。差额是尚无人提交的。
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="用户组" />
        <CardBody className="space-y-3">
          <p className="text-fg-muted text-sm leading-6">
            用户组由分流规则自动分配，组能做什么由下方的授权策略决定。
          </p>
          <ul className="space-y-2">
            {listGroups().map((group) => (
              <li key={group.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-fg text-sm font-medium">
                    {group.name}
                  </span>
                  <code className="text-fg-subtle font-mono text-xs">
                    {group.id}
                  </code>
                </div>
                <p className="text-fg-subtle text-xs leading-5">
                  {group.description}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="授权策略" />
        <CardBody className="space-y-3">
          <p className="text-fg-muted text-sm leading-6">
            未被放行的操作一律拒绝，<strong className="text-fg font-medium">禁止</strong>规则优先于<strong className="text-fg font-medium">放行</strong>规则。「有条件」表示该策略还取决于资源本身的属性。
          </p>
          <div className="border-border overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr className="text-fg-muted text-xs">
                  <th className="border-border border-b px-3 py-2 text-left font-semibold">
                    动作
                  </th>
                  <th className="border-border border-b px-3 py-2 text-left font-semibold">
                    策略
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {policyMatrix().map((entry) => (
                  <tr key={entry.action}>
                    <td className="w-1/3 px-3 py-2 align-top">
                      <code className="text-fg font-mono text-xs">
                        {entry.action}
                      </code>
                      <p className="text-fg-subtle mt-0.5 text-xs leading-5">
                        {entry.describe}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      {entry.policies.length === 0 ? (
                        <span className="text-fg-subtle text-xs">
                          没有任何策略，对所有人拒绝
                        </span>
                      ) : (
                        <ul className="space-y-1.5">
                          {entry.policies.map((rule) => (
                            <li key={rule.id}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge
                                  tone={
                                    rule.effect === "forbid" ? "warn" : "ok"
                                  }
                                >
                                  {rule.effect === "forbid" ? "禁止" : "放行"}
                                </Badge>
                                <span className="text-fg text-xs font-medium">
                                  {rule.principal}
                                </span>
                                {rule.conditional ? (
                                  <Badge tone="info">有条件</Badge>
                                ) : null}
                                <code className="text-fg-subtle font-mono text-xs">
                                  {rule.id}
                                </code>
                              </div>
                              <p className="text-fg-muted mt-0.5 text-xs leading-5">
                                {rule.describe}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-fg text-sm font-medium">
                  {ruleset.name}
                </span>
                <code className="text-fg-subtle font-mono text-xs">
                  {ruleset.id}
                </code>
              </div>
              <p className="text-fg-muted text-xs leading-5">
                {ruleset.description}
              </p>
            </div>
          ))}
          <p className="text-fg-subtle border-border border-t pt-3 text-xs leading-5">
            赛制在仓库中定义，修改后重新部署即可生效。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
