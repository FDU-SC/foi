import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getViewer } from "@/auth";
import { accountsFor } from "@/lib/accounts/access";
import { declaredGroupIds, groupName, isPrivileged } from "@/lib/auth/groups";
import {
  enrollmentPolicy,
  knownGroups,
  listGrants,
  listRules,
  groupsFor,
} from "@/lib/enrollment/registry";

export const metadata: Metadata = { title: "分流规则" };
export const dynamic = "force-dynamic";

/**
 * The read-only view of `content/enrollment/`, with the one thing the file
 * itself cannot show: how many accounts each rule actually matches.
 *
 * That number is the point of the page. A rule that has fallen behind the
 * current intake's address format looks perfectly reasonable in a diff and
 * matches nobody in production, and a zero here is how you find out before a
 * contest opens to an empty board.
 */
export default async function AdminEnrollmentPage() {
  const [rules, grants, accounts] = await Promise.all([
    Promise.resolve(listRules()),
    Promise.resolve(listGrants()),
    // Rule hit counts are computed from addresses, so this page reads PII too
    // and answers to the same capability as the account directory.
    accountsFor(await getViewer()),
  ]);

  const active = accounts.filter((row) => row.status === "active");
  const { groups: allGroups, exhaustive } = knownGroups();

  // Declared groups start at zero so they are listed even when empty. That is
  // the whole value of this card right after somebody adds a group: a count of
  // 0 next to a name you just wrote is how a mistyped grant announces itself,
  // and absence from the list would not.
  const groupCounts = new Map<string, number>(
    declaredGroupIds().map((id) => [id, 0]),
  );
  let untagged = 0;
  for (const row of active) {
    const resolved = groupsFor(row.handle, row.email);
    if (resolved.length === 0 && row.email) untagged += 1;
    for (const id of resolved) {
      groupCounts.set(id, (groupCounts.get(id) ?? 0) + 1);
    }
  }

  const ruleMatches = rules.map(
    (rule) => active.filter((row) => row.email && rule.match.test(row.email)).length,
  );

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
          的只读视图。仓库里写的不是人名清单而是分类规则：一条正则比两百个名字更短，不会过时，而且说清了某人为什么属于某个分组。改规则提
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
              <dt className="text-fg-muted">要求验证邮箱</dt>
              <dd>
                <Badge
                  tone={
                    enrollmentPolicy.requireEmailVerification ? "ok" : "warn"
                  }
                >
                  {enrollmentPolicy.requireEmailVerification ? "是" : "否"}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">未验证回收</dt>
              <dd className="text-fg font-mono text-xs">
                {enrollmentPolicy.unverifiedTtlHours} 小时
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
        <CardHeader title="邮箱分流规则" />
        <CardBody className="space-y-3">
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
                    <th className="border-border border-b px-3 py-2 text-right font-semibold">
                      命中账号
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {rules.map((rule, index) => (
                    <tr key={rule.label}>
                      <td className="text-fg px-3 py-2 align-top text-sm">
                        {rule.label}
                      </td>
                      <td className="text-fg-muted px-3 py-2 align-top font-mono text-xs break-all">
                        {String(rule.match)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {typeof rule.groups === "function" ? (
                          <span className="text-fg-subtle text-xs">
                            由邮箱计算得出
                          </span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {rule.groups.map((id) => (
                              <Badge key={id}>{groupName(id)}</Badge>
                            ))}
                          </span>
                        )}
                      </td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {untagged > 0 ? (
            <p className="text-warn text-xs leading-5">
              有 <span className="font-mono">{untagged}</span>{" "}
              个账号的邮箱不匹配任何规则，他们进不了任何 tag 制比赛。
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="当前用户组分布" />
        <CardBody>
          {groupCounts.size === 0 ? (
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

      <Card>
        <CardHeader title="授权" />
        <CardBody className="space-y-3">
          <p className="text-fg-muted text-sm leading-6">
            带权限的用户组只能来自这里，永远不会由邮箱推导——正则写错就发出去一个管理员是不可接受的。给谁提权必须在文件里指名道姓，这既让改动可
            review，也把理由留在了 git 历史里。
          </p>
          {grants.length === 0 ? (
            <p className="text-fg-muted text-sm">还没有任何授权。</p>
          ) : (
            <ul className="divide-border divide-y">
              {grants.map((grant) => (
                <li
                  key={grant.handle}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <code className="text-fg font-mono text-xs">
                    {grant.handle}
                  </code>
                  {grant.displayName ? (
                    <Badge tone="info">引导账号</Badge>
                  ) : null}
                  {grant.groups.map((id) => (
                    <Badge key={id} tone={isPrivileged(id) ? "primary" : "neutral"}>
                      {groupName(id)}
                    </Badge>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
