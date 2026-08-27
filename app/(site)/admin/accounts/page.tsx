import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { adminAccountsFor } from "@/lib/admin/access";
import type { AccountRow, AccountSuspensionRow } from "@/lib/db/schema";
import { dateFormatter } from "@/lib/format";
import { groupName, hasPrivilege, isPrivileged } from "@/lib/permissions/groups";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ResendResetForm } from "../resend-reset-form";
import { ModerateForm } from "../moderate-form";

export const metadata: Metadata = { title: "账号" };
export const dynamic = "force-dynamic";

const formatter = dateFormatter({ dateStyle: "short", timeStyle: "short" });

const STATUS: Record<string, { label: string; tone: "ok" | "err" }> = {
  active: { label: "正常", tone: "ok" },
  suspended: { label: "已封禁", tone: "err" },
};

function ModerationNote({
  row,
  lastEvent,
}: {
  row: AccountRow | undefined;
  lastEvent: AccountSuspensionRow | undefined;
}) {
  if (!lastEvent) return null;

  const by = `由 ${lastEvent.performedBy}`;

  if (row?.status === "suspended" && lastEvent.action === "suspend") {
    return (
      <p className="text-fg-subtle mt-1 text-xs leading-4">
        {lastEvent.reason}
        <br />
        {by}
      </p>
    );
  }

  if (lastEvent.action === "reinstate") {
    return (
      <p className="text-fg-subtle mt-1 text-xs leading-4">
        {formatter.format(lastEvent.createdAt)} 解封，{by}
      </p>
    );
  }

  return null;
}

export default async function AdminAccountsPage({
  searchParams,
}: PageProps<"/admin/accounts">) {
  const viewer = await getViewer();

  const [directory, params] = await Promise.all([
    adminAccountsFor(viewer),
    searchParams,
  ]);
  if (!directory) notFound();

  const { accounts: rows, lastSuspensionEvents } = directory;

  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const byUid = new Map(rows.map((row) => [row.uid, row]));

  const accounts = rows
    .map(resolveFromRow)
    .filter(
      (account) =>
        query.length === 0 ||
        account.username.toLowerCase().includes(query) ||
        account.nickname.toLowerCase().includes(query) ||
        (account.email?.includes(query) ?? false) ||
        account.groups.some((group) => group.toLowerCase().includes(query)),
    );

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
          ：它们由{" "}
          <code className="font-mono">content/enrollment/</code> 的{" "}
          <Link href="/admin/enrollment" className="hover:text-fg underline">
          分流规则
        </Link>{" "}
        现算，一部分按邮箱匹配，一部分按用户名点名。要给谁提权或改分组，提 PR 改那个文件，部署后下一个请求就生效。
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
              const row = byUid.get(account.uid);
              const status = STATUS[account.status];
              return (
                <tr key={account.uid} className="hover:bg-surface-2/60">
                  <td className="text-fg px-4 py-2.5 font-mono text-xs">
                    {account.username}
                  </td>
                  <td className="text-fg px-4 py-2.5">{account.nickname}</td>

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
                    <ModerationNote row={row} lastEvent={lastSuspensionEvents.get(account.uid)} />
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
                    {row?.passwordSetAt ? (
                      <span className="text-fg-subtle font-mono text-xs">
                        {formatter.format(row.passwordSetAt)}
                      </span>
                    ) : (
                      <Badge tone="warn">未设置密码</Badge>
                    )}
                  </td>
                  {showActions ? (
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-end gap-1.5">
                        {canManage && !account.disabled ? (
                          <ResendResetForm
                            uid={account.uid}
                            hasPassword={row?.passwordSetAt != null}
                          />
                        ) : null}

                        {canModerate && !hasPrivilege(account.groups) ? (
                          <ModerateForm
                            uid={account.uid}
                            username={account.username}
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
