import { NavigationLinks } from "@/components/site/navigation-links";
import { PageHeader } from "@/components/ui/page";
import { AdminNav } from "@/components/admin/admin-nav";
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
      <AdminNav />
      <PageHeader
        title="管理"
        actions={<NavigationLinks viewer={viewer} location="admin" />}
      />

      <p className="text-fg-muted flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {stats.map((stat) => {
          const content = (
            <>
              {stat.label}{" "}
              <span className="text-fg font-semibold tabular-nums">{stat.value}</span>
            </>
          );
          return stat.href ? (
            <Link
              key={stat.label}
              href={stat.href}
              className="hover:text-fg underline-offset-2 transition-colors hover:underline"
            >
              {content}
            </Link>
          ) : (
            <span key={stat.label}>{content}</span>
          );
        })}
      </p>

      <Card>
        <CardHeader title="配置检查" />
        <CardBody>
          {overview.findings.length === 0 ? (
            <p className="text-fg-muted text-sm leading-6">
              未发现配置问题。
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
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="用户组" />
        <CardBody className="space-y-3">
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
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg-muted text-xs">
                  <th className="border-fg border-b px-3 py-2 text-left font-medium">
                    动作
                  </th>
                  <th className="border-fg border-b px-3 py-2 text-left font-medium">
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
                          未配置
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
        </CardBody>
      </Card>
    </div>
  );
}
