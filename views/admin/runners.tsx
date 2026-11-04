import { AdminNav } from "@/components/admin/admin-nav";
import { IssueTokenForm } from "@/components/admin/issue-token-form";
import { RevokeTokenForm } from "@/components/admin/revoke-token-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page";
import { adminRunnerTokensFor } from "@/lib/admin/access";
import { dateFormatter } from "@/lib/format";
import type { RunnerTokenListing } from "@/lib/runner/tokens";

const formatter = dateFormatter({ dateStyle: "short", timeStyle: "short" });

function byWhom(name: string | null): string {
  return name ? `，由 ${name}` : "";
}

function TokenRow({ token }: { token: RunnerTokenListing }) {
  const revoked = token.revokedAt !== null;

  return (
    <tr className={revoked ? "text-fg-subtle" : undefined}>
      <td className="px-4 py-2.5">
        <span className={revoked ? undefined : "text-fg"}>{token.label}</span>
      </td>
      <td className="px-4 py-2.5 font-mono text-xs">{token.keyId}</td>
      <td className="text-fg-muted px-4 py-2.5 text-xs">
        {formatter.format(token.createdAt)}
        {byWhom(token.createdByName)}
      </td>
      <td className="text-fg-muted px-4 py-2.5 text-xs">
        {token.lastUsedAt ? formatter.format(token.lastUsedAt) : "从未使用"}
      </td>
      <td className="px-4 py-2.5">
        {token.revokedAt ? (
          <>
            <Badge>已吊销</Badge>
            <p className="mt-1 text-xs leading-4">
              {formatter.format(token.revokedAt)}
              {byWhom(token.revokedByName)}
            </p>
          </>
        ) : (
          <Badge tone="ok">有效</Badge>
        )}
      </td>
      <td className="px-4 py-2.5">
        {revoked ? null : (
          <RevokeTokenForm keyId={token.keyId} label={token.label} />
        )}
      </td>
    </tr>
  );
}

export async function AdminRunnersView() {
  const groups = await adminRunnerTokensFor(await getViewer());
  if (!groups) notFound();

  return (
    <div className="space-y-4">
      <AdminNav />
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>评测机令牌</span>
      </nav>

      <h1 className="text-fg text-xl font-bold">评测机令牌</h1>

      {groups.length === 0 ? (
        <EmptyState>没有可签发令牌的评测后端。</EmptyState>
      ) : (
        <>
          <Card>
            <CardHeader title="签发令牌" />
            <CardBody>
              <IssueTokenForm backendIds={groups.map((group) => group.backendId)} />
            </CardBody>
          </Card>

          {groups.map(({ backendId, tokens }) => {
            const live = tokens.filter((token) => token.revokedAt === null).length;
            return (
              <Card key={backendId}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{backendId}</span>
                      <Badge tone={live > 0 ? "ok" : "neutral"}>
                        {live} 个有效令牌
                      </Badge>
                    </span>
                  }
                />
                <CardBody>
                  {tokens.length === 0 ? (
                    <p className="text-fg-subtle text-xs">还没有签发令牌。</p>
                  ) : (
                    <div className="oj-table-frame">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-fg-muted text-xs">
                            <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                              备注
                            </th>
                            <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                              编号
                            </th>
                            <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                              签发
                            </th>
                            <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                              最近使用
                            </th>
                            <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                              状态
                            </th>
                            <th className="border-border border-b px-4 py-2.5 text-right font-semibold">
                              <span className="sr-only">操作</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-border divide-y">
                          {tokens.map((token) => (
                            <TokenRow key={token.keyId} token={token} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
