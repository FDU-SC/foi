import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { listAccounts } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { listCredentials } from "@/lib/auth/credentials";
import { roleName } from "@/lib/auth/policy";
import { userCan } from "@/lib/auth/session";
import { listPendingTokens } from "@/lib/auth/tokens";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { IssueCodeForm } from "../issue-code-form";
import { ModerateForm } from "../moderate-form";

export const metadata: Metadata = { title: "账号" };
export const dynamic = "force-dynamic";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "err" }> = {
  active: { label: "正常", tone: "ok" },
  pending: { label: "待验证", tone: "warn" },
  suspended: { label: "已封禁", tone: "err" },
};

export default async function AdminAccountsPage({
  searchParams,
}: PageProps<"/admin/accounts">) {
  const [user, rows, credentials, pendingCodes, params] = await Promise.all([
    getSessionUser(),
    listAccounts(),
    listCredentials(),
    listPendingTokens("setup_code"),
    searchParams,
  ]);

  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const suspensions = new Map(rows.map((row) => [row.handle, row]));

  const accounts = rows
    .map(resolveFromRow)
    .filter(
      (account) =>
        query.length === 0 ||
        account.handle.includes(query) ||
        account.displayName.toLowerCase().includes(query) ||
        (account.email?.includes(query) ?? false) ||
        account.tags.some((tag) => tag.toLowerCase().includes(query)),
    );

  const byHandle = new Map(credentials.map((row) => [row.handle, row]));
  const awaitingCode = new Set(pendingCodes.map((row) => row.handle));
  const canManage = userCan(user, "credential.manage");
  const canModerate = userCan(user, "account.moderate");
  const showActions = canManage || canModerate;

  return (
    <div className="space-y-6">
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>账号</span>
      </nav>

      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">账号</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          账号由注册产生，这里列出的是数据库里的真实记录。
          <strong className="text-fg font-medium">角色和标签不在这张表里</strong>
          ：角色来自{" "}
          <code className="font-mono">content/enrollment/</code> 的 grants
          ，标签由邮箱按{" "}
          <Link href="/admin/enrollment" className="hover:text-fg underline">
          分流规则
        </Link>{" "}
        现算。要给谁提权或改分组，提 PR 改规则，部署后下一个请求就生效。
        </p>
      </div>

      <form className="flex gap-2" action="/admin/accounts">
        <Field label="">
          <Input
            name="q"
            defaultValue={query}
            placeholder="按用户名、显示名、邮箱或标签筛选"
            className="w-72"
            spellCheck={false}
          />
        </Field>
        <Button type="submit" size="sm" className="self-start">
          筛选
        </Button>
        {query ? (
          <Link
            href="/admin/accounts"
            className="text-fg-subtle hover:text-fg self-center text-xs underline"
          >
            清除
          </Link>
        ) : null}
      </form>

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
                邮箱
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                状态
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                角色
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                标签（派生）
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                凭据
              </th>
              {showActions ? (
                <th className="border-border border-b px-4 py-2.5 text-right font-semibold">
                  操作
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {accounts.map((account) => {
              const credential = byHandle.get(account.handle);
              const status = STATUS[account.status];
              return (
                <tr key={account.handle} className="hover:bg-surface-2/60">
                  <td className="text-fg px-4 py-2.5 font-mono text-xs">
                    {account.handle}
                  </td>
                  <td className="text-fg px-4 py-2.5">{account.displayName}</td>
                  <td className="px-4 py-2.5">
                    {account.email ? (
                      <span className="text-fg-muted font-mono text-xs">
                        {account.email}
                        {account.emailVerified ? null : (
                          <Badge tone="warn" className="ml-1.5">
                            未验证
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <span className="text-fg-subtle text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {account.status === "suspended" ? (
                      <p className="text-fg-subtle mt-1 text-xs leading-4">
                        {suspensions.get(account.handle)?.suspendedReason}
                        <br />
                        由 {suspensions.get(account.handle)?.suspendedBy}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={account.role === "user" ? "neutral" : "primary"}
                    >
                      {roleName(account.role)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {account.tags.length === 0 ? (
                      <span className="text-fg-subtle text-xs">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {account.tags.map((tag) => (
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
                    ) : awaitingCode.has(account.handle) ? (
                      <Badge tone="info">设置码待用</Badge>
                    ) : (
                      <Badge tone="warn">未设置密码</Badge>
                    )}
                  </td>
                  {showActions ? (
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-end gap-1.5">
                        {canManage && !account.disabled ? (
                          <IssueCodeForm
                            handle={account.handle}
                            hasPassword={credential?.hasPassword ?? false}
                          />
                        ) : null}
                        {canModerate ? (
                          <ModerateForm
                            handle={account.handle}
                            suspended={account.status === "suspended"}
                          />
                        ) : null}
                      </div>
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
