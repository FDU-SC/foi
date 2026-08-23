import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { listCredentials } from "@/lib/auth/credentials";
import { roleName } from "@/lib/auth/policy";
import { userCan } from "@/lib/auth/session";
import { listMembers, listTags } from "@/lib/roster/registry";
import { IssueCodeForm } from "./issue-code-form";

export const metadata: Metadata = { title: "名册" };
export const dynamic = "force-dynamic";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

export default async function AdminRosterPage() {
  const [user, members, credentials] = await Promise.all([
    getSessionUser(),
    Promise.resolve(listMembers({ includeDisabled: true })),
    listCredentials(),
  ]);

  const byHandle = new Map(credentials.map((row) => [row.handle, row]));
  const canManage = userCan(user, "credential.manage");
  const tags = listTags();

  return (
    <div className="space-y-6">
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>名册</span>
      </nav>

      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">名册</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          这张表是 <code className="font-mono">content/roster/</code>{" "}
          的只读视图。增删成员、改角色、停用账号都在那里改，提 PR
          即可——角色在每个请求解析，部署上线后立刻对已登录的人生效。这里唯一能做的写操作是签发密码设置码，因为密码是唯一不能写进仓库的东西。
        </p>
      </div>

      {tags.length > 0 ? (
        <Card>
          <CardHeader title="标签" />
          <CardBody>
            <p className="text-fg-muted mb-2 text-xs leading-5">
              比赛用 <code className="font-mono">participants.tag</code>{" "}
              引用这些标签来确定参赛名单。
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li key={tag}>
                  <Badge tone="primary">{tag}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr className="text-fg-muted text-xs">
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                用户名
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                显示名
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                角色
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                标签
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                凭据
              </th>
              {canManage ? (
                <th className="border-border border-b px-4 py-2.5 text-right font-semibold">
                  操作
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {members.map((member) => {
              const credential = byHandle.get(member.handle);
              return (
                <tr key={member.handle} className="hover:bg-surface-2/60">
                  <td className="text-fg px-4 py-2.5 font-mono text-xs">
                    {member.handle}
                  </td>
                  <td className="text-fg px-4 py-2.5">{member.displayName}</td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={member.role === "user" ? "neutral" : "primary"}
                    >
                      {roleName(member.role)}
                    </Badge>
                    {member.disabled ? (
                      <Badge tone="err" className="ml-1.5">
                        已停用
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    {member.tags.length === 0 ? (
                      <span className="text-fg-subtle text-xs">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {member.tags.map((tag) => (
                          <Badge key={tag}>{tag}</Badge>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {credential?.hasPassword ? (
                      <span className="text-fg-subtle font-mono text-xs">
                        {formatter.format(credential.updatedAt)}
                      </span>
                    ) : credential?.setupExpiresAt ? (
                      <Badge tone="info">设置码待用</Badge>
                    ) : (
                      <Badge tone="warn">未设置密码</Badge>
                    )}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2.5 text-right">
                      {member.disabled ? (
                        <span className="text-fg-subtle text-xs">—</span>
                      ) : (
                        <IssueCodeForm
                          handle={member.handle}
                          hasPassword={credential?.hasPassword ?? false}
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
