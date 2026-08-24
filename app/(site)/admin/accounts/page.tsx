import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { accountDirectoryFor } from "@/lib/accounts/access";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { groupName, isPrivileged } from "@/lib/auth/groups";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ResendResetForm } from "../resend-reset-form";
import { ModerateForm } from "../moderate-form";

export const metadata: Metadata = { title: "账号" };
export const dynamic = "force-dynamic";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

const STATUS: Record<string, { label: string; tone: "ok" | "err" }> = {
  active: { label: "正常", tone: "ok" },
  suspended: { label: "已封禁", tone: "err" },
};

/**
 * Whether this account holds any privilege, and therefore may not be suspended
 * from here — `suspendAccountAction` refuses it, and offering the button anyway
 * would be an invitation to discover that the hard way.
 */
function isPrivilegedAccount(account: { groups: string[] }): boolean {
  return account.groups.some(isPrivileged);
}

export default async function AdminAccountsPage({
  searchParams,
}: PageProps<"/admin/accounts">) {
  const viewer = await getViewer();

  // The console shell answers to `admin.access`; the directory inside it
  // answers to `account.read`, because it is the one page here showing
  // personal data rather than platform state. Both are checked — a viewer with
  // neither should not be looking at an empty admin page, and `proxy.ts`
  // guards the URL prefix, which is not the same thing as guarding the data.
  if (!viewer.can("admin.access")) notFound();

  const [directory, params] = await Promise.all([
    accountDirectoryFor(viewer),
    searchParams,
  ]);
  const { accounts: rows, credentials, awaitingReset } = directory;

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
        account.groups.some((group) => group.toLowerCase().includes(query)),
    );

  const byHandle = new Map(credentials.map((row) => [row.handle, row]));
  const canManage = viewer.can("credential.manage");
  const canModerate = viewer.can("account.moderate");
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
          <strong className="text-fg font-medium">用户组不在这张表里</strong>
          ：用户组一部分来自{" "}
          <code className="font-mono">content/enrollment/</code> 的 grants，
          一部分由邮箱按{" "}
          <Link href="/admin/enrollment" className="hover:text-fg underline">
          分流规则
        </Link>{" "}
        现算。要给谁提权或改分组，提 PR 改那个文件，部署后下一个请求就生效。
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
                用户组（派生）
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
                  {/*
                    No "unverified" badge: registration proves the address
                    before it writes the row, so an account with an address has
                    a verified one and the branch was unreachable. A bootstrap
                    account has no address at all, which is the other column.
                  */}
                  <td className="px-4 py-2.5">
                    {account.email ? (
                      <span className="text-fg-muted font-mono text-xs">
                        {account.email}
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
                    {account.groups.length === 0 ? (
                      <span className="text-fg-subtle text-xs">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {account.groups.map((group) => (
                          <Badge
                            key={group}
                            tone={isPrivileged(group) ? "primary" : "neutral"}
                          >
                            {groupName(group)}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {credential?.hasPassword ? (
                      <span className="text-fg-subtle font-mono text-xs">
                        {formatter.format(credential.updatedAt)}
                      </span>
                    ) : (
                      <Badge tone="warn">未设置密码</Badge>
                    )}
                    {awaitingReset.has(account.handle) ? (
                      <Badge tone="info" className="ml-1.5">
                        重置链接待用
                      </Badge>
                    ) : null}
                  </td>
                  {showActions ? (
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-end gap-1.5">
                        {canManage && !account.disabled ? (
                          <ResendResetForm
                            handle={account.handle}
                            hasPassword={credential?.hasPassword ?? false}
                          />
                        ) : null}
                        {canModerate && !isPrivilegedAccount(account) ? (
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
