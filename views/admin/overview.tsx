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
          这个页面不改配置。分流规则、权限、比赛与题目的真源都在仓库里，改动走
          pull request；这里核对仓库与数据库是否一致。唯二的写操作是给某个账号补发一封找回密码邮件和封禁账号——前者的链接直达本人邮箱、不经管理员的手，后者则不该为了封一个垃圾注册号去走一次 code review。
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
              没有发现偏差：邮件通道已配置，有邮箱的在用账号都能匹配到分流规则，规则点名的用户名都已有人注册，每台题目后端都持有各自的签名密钥、都有题目指向、生产环境下地址也都没有指向本机，镜像表里也没有仓库中已删除的条目。
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
              镜像表只是外键锚点，行在第一次有人提交时写入：数据库里有{" "}
              <span className="font-mono">{overview.mirroredProblems}</span>{" "}
              道题、<span className="font-mono">{overview.mirroredContests}</span>{" "}
              场比赛被提交过，仓库里共{" "}
              <span className="font-mono">{overview.problemCount}</span> 道题、
              <span className="font-mono">{overview.contestCount}</span>{" "}
              场比赛。差额是还没有人交过的那些。
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="用户组" />
        <CardBody className="space-y-3">
          <p className="text-fg-muted text-sm leading-6">
            用户组不存在数据库里，也不携带任何权限——它只是一个标签。谁属于哪个组由{" "}
            <code className="font-mono">content/enrollment/</code>{" "}
            的分流规则每次请求现算，组能做什么由下面那张策略表决定。
            这里只列出显式声明过的组；纯分组不需要声明，出现在规则、受众或参赛范围里即可使用。
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
            平台默认拒绝：没有被任何一条 <strong className="text-fg font-medium">放行</strong>{" "}
            命中的请求就是不允许，而任何一条{" "}
            <strong className="text-fg font-medium">禁止</strong>{" "}
            命中都压过全部放行。带{" "}
            <code className="font-mono">builtin:</code>{" "}
            前缀的来自内核，其余来自{" "}
            <code className="font-mono">content/policies/</code>——改权限就是改那个目录，变更会出现在
            diff 里。「有条件」表示这条策略还要看资源本身，具体条件写在代码里。
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
            新增赛制：在 <code className="font-mono">content/rulesets/</code>{" "}
            下新建一个模块，导出名为{" "}
            <code className="font-mono">ruleset</code> 的常量即可，不需要登记。
            只给一场比赛用的赛制放在{" "}
            <code className="font-mono">content/contests/&lt;slug&gt;/ruleset.tsx</code>
            ，那样它会和这场比赛一起冻结，不随共享模板演进——排行榜每次打开都重算，改共享模板会改动历史比赛的名次。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
