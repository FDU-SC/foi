import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { confirmEmailChangeAction } from "../actions";

export const metadata: Metadata = { title: "确认修改邮箱" };

export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getResolvedUser();
  if (!user) redirect("/login");

  const { token } = await searchParams;
  if (!token) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-fg text-2xl font-bold tracking-tight">
          确认修改邮箱
        </h1>
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm">
          链接不完整，缺少验证参数。
        </p>
        <Link
          href="/settings/email"
          className="text-fg-muted hover:text-fg text-sm underline"
        >
          返回修改邮箱
        </Link>
      </div>
    );
  }

  const result = await confirmEmailChangeAction(token);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-fg text-2xl font-bold tracking-tight">
        确认修改邮箱
      </h1>

      {result.error ? (
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm">
          {result.error}
        </p>
      ) : (
        <p className="text-fg-muted bg-surface-2 rounded-md px-3 py-2 text-sm">
          {result.message}
        </p>
      )}

      <Link
        href="/"
        className="bg-primary text-primary-fg hover:bg-primary-hover block rounded-md px-3 py-2 text-center text-sm font-medium transition-colors"
      >
        返回首页
      </Link>
    </div>
  );
}
