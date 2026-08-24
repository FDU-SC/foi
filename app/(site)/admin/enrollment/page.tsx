import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getViewer } from "@/auth";
import { enrollmentViewFor } from "@/lib/admin/access";
import { codeTtlMinutes } from "@/lib/auth/email-verification";
import { groupName, isPrivileged } from "@/lib/auth/groups";
import { isHandlesRule } from "@/lib/enrollment/types";

export const metadata: Metadata = { title: "分流规则" };
export const dynamic = "force-dynamic";

export default async function AdminEnrollmentPage() {
  const view = await enrollmentViewFor(await getViewer());
  if (!view) notFound();

  const {
    policy: enrollmentPolicy,
    rules,
    known: { groups: allGroups, exhaustive },
    ruleMatches,
    groupCounts,
    untagged,
  } = view;

  return (
    <div className="space-y-6">
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>分流规则</span>
      </nav>

      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">分流规则</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          这是 <code className="font-mono">content/enrollment/</code>{" "}
          的只读视图。仓库里存的不是人名清单而是分类规则：一条正则比两百个名字更短，不会过时，而且说清了某人为什么属于某个分组。改规则提
          PR，部署后所有受影响的人在下一个请求就重新分流，不需要回填。
        </p>
      </div>

      <Card>
        <CardHeader title="注册策略" />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">开放注册</dt>
              <dd>
                <Badge tone={enrollmentPolicy.enabled ? "ok" : "neutral"}>
                  {enrollmentPolicy.enabled ? "是" : "否"}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">验证码有效期</dt>
              <dd className="text-fg font-mono text-xs">
                {codeTtlMinutes} 分钟
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">单 IP 每小时注册上限</dt>
              <dd className="text-fg font-mono text-xs">
                {enrollmentPolicy.registrationsPerIpPerHour}
              </dd>
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
          <p className="text-fg-muted text-sm leading-6">
            规则有两种形态，形态决定了它能不能发权限。按邮箱匹配的规则一条覆盖一整届，但发不出带权限的组——正则覆盖的地址是无穷的，注册时无法预留，写错一位数就会把权限发给一片人。列出
            handles 的规则可以发权限，因为有限的名单能被预留：注册流程会拒绝这些用户名，所以规则命中就意味着这个人正是仓库指的那个人。
          </p>
          {rules.length === 0 ? (
            <p className="text-fg-muted text-sm leading-6">
              还没有任何规则，注册用户不会进入任何用户组，按组划定参赛范围的比赛将没有参赛者。
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
                        {isHandlesRule(rule)
                          ? rule.handles.join("、")
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
                                tone={isPrivileged(id) ? "primary" : "neutral"}
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
              命中账号数要读账号目录，需要{" "}
              <code className="font-mono">account.read</code> 才会显示。
            </p>
          ) : (
            <p className="text-fg-subtle text-xs leading-5">
              命中数标黄说明这条规则一个人也没匹配上。邮箱规则多半是位数没跟真实学号对齐；handles
              规则则是用户名拼错了，或者那个人还没注册。
            </p>
          )}
          {untagged !== null && untagged > 0 ? (
            <p className="text-warn text-xs leading-5">
              有 <span className="font-mono">{untagged}</span>{" "}
              个账号的邮箱不匹配任何规则，他们进不了任何按用户组划定参赛范围的比赛。
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="当前用户组分布" />
        <CardBody>
          {groupCounts === null ? (
            <p className="text-fg-muted text-sm leading-6">
              分布要按邮箱现算每个账号的用户组，需要{" "}
              <code className="font-mono">account.read</code>。这里列出的是{" "}
              {allGroups.length} 个仓库声明或规则产生的用户组名。
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
                          : isPrivileged(id)
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
          <p className="text-fg-subtle mt-3 text-xs leading-5">
            比赛用 <code className="font-mono">participants.group</code>{" "}
            引用这些用户组。
            {exhaustive
              ? `仓库能静态枚举出的用户组共 ${allGroups.length} 个，因此引用了不存在用户组的比赛会在启动时告警。`
              : "有规则的用户组是算出来的，无法静态枚举，因此启动时不会校验比赛引用的用户组是否存在。"}
          </p>
        </CardBody>
      </Card>

    </div>
  );
}
