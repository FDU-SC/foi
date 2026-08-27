import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { adminAccountsFor } from "@/lib/admin/access";
import type { AccountRow } from "@/lib/db/schema";
import { groupName, hasPrivilege, isPrivileged } from "@/lib/permissions/groups";
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
 * What the four audit columns say, which depends on `status` and nothing else.
 *
 * Suspended reads them as the current decision; active reads the same columns
 * as a closed episode, and that second case is the whole reason `reinstatedAt`
 * exists. Without it a reinstated row would either show nothing — losing the
 * record a reinstatement used to erase outright — or show a reason with no way
 * to say it is over.
 *
 * Only the most recent episode. A second suspension overwrites the first, so
 * this is deliberately not a timeline; see `reinstateAccount` for why an
 * events table is a bigger claim than the console makes.
 */
function ModerationNote({ row }: { row: AccountRow | undefined }) {
  if (!row?.suspendedAt) return null;

  const by = row.suspendedBy ? `由 ${row.suspendedBy}` : null;

  if (row.status === "suspended") {
    return (
      <p className="text-fg-subtle mt-1 text-xs leading-4">
        {row.suspendedReason}
        {by ? (
          <>
            <br />
            {by}
          </>
        ) : null}
      </p>
    );
  }

  return (
    <p className="text-fg-subtle mt-1 text-xs leading-4">
      曾于 {formatter.format(row.suspendedAt)} 被封禁
      {by ? `，${by}` : ""}
      <br />
      {row.reinstatedAt
        ? `${formatter.format(row.reinstatedAt)} 解封`
        : "已解封，时间未记录"}
    </p>
  );
}

export default async function AdminAccountsPage({
  searchParams,
}: PageProps<"/admin/accounts">) {
  const viewer = await getViewer();

  // Null when the console itself is closed to them, the same way the other
  // three pages here learn it. Both capabilities are still asked, just not by
  // this file: the shell answers to `admin.access` and the directory inside it
  // to `account.read`, because it is the one page here showing personal data
  // rather than platform state. `proxy.ts` guards the URL prefix, which is not
  // the same thing as guarding the data.
  const [directory, params] = await Promise.all([
    adminAccountsFor(viewer),
    searchParams,
  ]);
  if (!directory) notFound();

  const { accounts: rows, awaitingReset } = directory;

  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const byHandle = new Map(rows.map((row) => [row.handle, row]));

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
              const row = byHandle.get(account.handle);
              const status = STATUS[account.status];
              return (
                <tr key={account.handle} className="hover:bg-surface-2/60">
                  <td className="text-fg px-4 py-2.5 font-mono text-xs">
                    {account.handle}
                  </td>
                  <td className="text-fg px-4 py-2.5">{account.displayName}</td>
                  {/*
                    No "unverified" badge: both ways in prove the address
                    before writing the row — the form with a code, the CLI by
                    an operator typing it — so an account with an address has a
                    verified one. The dash is for rows predating that.
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
                    <ModerationNote row={row} />
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
                            hasPassword={row?.passwordSetAt != null}
                          />
                        ) : null}
                        {/* `suspendAccountAction` refuses a privileged target,
                            so drawing the button anyway would be an invitation
                            to discover that the hard way. */}
                        {canModerate && !hasPrivilege(account.groups) ? (
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
