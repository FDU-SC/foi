import { AdminNav } from "@/components/admin/admin-nav";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getViewer } from "@/auth";
import { enrollmentViewFor } from "@/lib/admin/access";
import { groupName } from "@/lib/authz/groups";
import { isPrivilegedGroup } from "@/lib/authz/introspect";
import { registrationOpen } from "@/lib/enrollment/register";
import { isUidsRule } from "@/lib/enrollment/types";

export async function AdminEnrollmentView() {
  const view = await enrollmentViewFor(await getViewer());
  if (!view) notFound();

  const {
    policy: enrollmentPolicy,
    rules,
    known: { groups: allGroups },
    ruleMatches,
    groupCounts,
    untagged,
  } = view;

  return (
    <div className="space-y-4">
      <AdminNav />
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>分流规则</span>
      </nav>

      <h1 className="text-fg text-2xl font-bold tracking-tight">分流规则</h1>

      <Card>
        <CardHeader title="注册策略" />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">开放注册</dt>
              <dd>
                <Badge tone={registrationOpen() ? "ok" : "neutral"}>
                  {registrationOpen() ? "是" : "否"}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">验证链接有效期</dt>
              <dd className="text-fg font-mono text-xs">30 分钟</dd>
            </div>
          </dl>
          <div className="border-border mt-3 border-t pt-3">
            <p className="text-fg-subtle mb-1.5 text-xs">允许注册的邮箱域名</p>
            {enrollmentPolicy.emailDomains.length === 0 ? (
              <Badge tone="warn">不限，任何人都可以注册</Badge>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {enrollmentPolicy.emailDomains.map((domain) => (
                  <li key={domain}>
                    <Badge mono>{domain}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="分流规则" />
        <CardBody className="space-y-3">
          {rules.length === 0 ? (
            <p className="text-fg-muted text-sm leading-6">
              暂无分流规则，注册用户尚未分组。
            </p>
          ) : (
            <div className="border-border overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2">
                  <tr className="text-fg-muted text-xs">
                    <th className="border-border border-b px-3 py-2 text-left font-semibold">
                      说明
                    </th>
                    <th className="border-border border-b px-3 py-2 text-left font-semibold">
                      匹配
                    </th>
                    <th className="border-border border-b px-3 py-2 text-left font-semibold">
                      用户组
                    </th>
                    {ruleMatches ? (
                      <th className="border-border border-b px-3 py-2 text-right font-semibold">
                        命中账号
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {rules.map((rule, index) => (
                    <tr key={rule.label}>
                      <td className="text-fg px-3 py-2 align-top text-sm">
                        {rule.label}
                      </td>
                      <td className="text-fg-muted px-3 py-2 align-top font-mono text-xs break-all">
                        {isUidsRule(rule)
                          ? rule.uids.join("、")
                          : String(rule.email)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {typeof rule.groups === "function" ? (
                          <span className="text-fg-subtle text-xs">
                            由邮箱计算得出
                          </span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {rule.groups.map((id) => (
                              <Badge
                                key={id}
                                tone={
                                  isPrivilegedGroup(id) ? "primary" : "neutral"
                                }
                              >
                                {groupName(id)}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </td>
                      {ruleMatches ? (
                        <td className="px-3 py-2 text-right align-top">
                          <span
                            className={
                              ruleMatches[index] === 0
                                ? "text-warn font-mono text-sm tabular-nums"
                                : "text-fg font-mono text-sm tabular-nums"
                            }
                          >
                            {ruleMatches[index]}
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ruleMatches === null ? (
            <p className="text-fg-subtle text-xs leading-5">
              需要账号查看权限才能显示命中数。
            </p>
          ) : (
            <p className="text-fg-subtle text-xs leading-5">
              标黄表示该规则未匹配到任何账号。
            </p>
          )}
          {untagged !== null && untagged > 0 ? (
            <p className="text-warn text-xs leading-5">
              有 <span className="font-mono">{untagged}</span>{" "}
              个账号的邮箱未匹配分流规则，无法参加限定用户组的比赛。
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="当前用户组分布" />
        <CardBody>
          {groupCounts === null ? (
            <p className="text-fg-muted text-sm leading-6">
              需要账号查看权限才能统计分布。已知用户组共 {allGroups.length} 个。
            </p>
          ) : groupCounts.size === 0 ? (
            <p className="text-fg-muted text-sm">还没有任何用户组。</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {[...groupCounts.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([id, count]) => (
                  <li key={id}>
                    <Badge
                      tone={
                        count === 0
                          ? "warn"
                          : isPrivilegedGroup(id)
                            ? "primary"
                            : "neutral"
                      }
                    >
                      {groupName(id)} · {count}
                    </Badge>
                  </li>
                ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
