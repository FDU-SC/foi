import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { Badge } from "@/components/ui/badge";
import { activateAccount, getAccount } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { inspectToken, redeemToken } from "@/lib/auth/tokens";

export const metadata: Metadata = { title: "验证邮箱" };
export const dynamic = "force-dynamic";

type Outcome =
  | { kind: "ok"; handle: string; groups: string[] }
  | { kind: "error"; message: string };

/**
 * Spends a verification token on activating the account.
 *
 * This happens on GET, which is unusual for something that writes. The
 * alternative — landing on a page with a second button after already clicking
 * one in the email — is worse, and the write is the thing the person asked for
 * by clicking. What GET does force is handling a reload: the token is gone by
 * then, so a consumed token belonging to an account that is now active reports
 * success rather than telling somebody their brand-new account is invalid.
 */
async function verify(token: string): Promise<Outcome> {
  const result = await redeemToken(token, "email_verify");

  if (!result.ok) {
    const existing = await inspectToken(token, "email_verify");
    if (existing?.consumedAt) {
      const account = await getAccount(existing.handle);
      if (account?.status === "active") {
        const user = resolveFromRow(account);
        return { kind: "ok", handle: user.handle, groups: user.groups };
      }
    }
    return {
      kind: "error",
      message:
        result.reason === "expired"
          ? "验证链接已过期。请重新注册，或在注册页重新发送验证邮件。"
          : "验证链接无效。请确认链接完整，或重新发送验证邮件。",
    };
  }

  const account = await activateAccount(result.handle);
  if (!account) {
    return { kind: "error", message: "账号不存在，请重新注册。" };
  }

  const user = resolveFromRow(account);
  return { kind: "ok", handle: user.handle, groups: user.groups };
}

export default async function VerifyPage({
  searchParams,
}: PageProps<"/verify">) {
  if (await getSessionUser()) redirect("/");

  const { token } = await searchParams;
  const outcome =
    typeof token === "string" && token.length > 0
      ? await verify(token)
      : ({
          kind: "error",
          message: "链接不完整。请直接点击邮件中的按钮，或把完整地址复制到浏览器。",
        } satisfies Outcome);

  if (outcome.kind === "error") {
    return (
      <AuthShell
        footer={
          <>
            需要新的验证邮件？回到{" "}
            <Link href="/register" className="hover:text-fg underline">
              注册页
            </Link>
            重新发送。
          </>
        }
      >
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm leading-6">
          {outcome.message}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-4">
        <p className="text-ok bg-ok-subtle rounded-md px-3 py-2 text-sm leading-6">
          邮箱验证成功，账号{" "}
          <span className="font-mono">{outcome.handle}</span> 已启用。
        </p>

        {/* Showing the groups is how a mistyped address gets caught: they
            come from the address, so an empty list right after signing up is
            the earliest and clearest sign something is off. */}
        {outcome.groups.length > 0 ? (
          <div className="border-border rounded-md border px-3 py-2.5">
            <p className="text-fg-muted mb-1.5 text-xs">
              根据邮箱，你被归入以下分组：
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {outcome.groups.map((tag) => (
                <li key={tag}>
                  <Badge tone="primary">{tag}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-fg-subtle border-border rounded-md border px-3 py-2.5 text-xs leading-5">
            你的邮箱没有匹配到任何分组，因此暂时不会出现在按分组划定名单的比赛里。如果这不符合预期，请联系管理员。
          </p>
        )}

        <Link
          href="/login"
          className="bg-primary text-primary-fg hover:bg-primary-hover block rounded-md px-3 py-2 text-center text-sm font-medium transition-colors"
        >
          前往登录
        </Link>
      </div>
    </AuthShell>
  );
}
