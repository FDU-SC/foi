import Link from "next/link";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetForm } from "@/components/auth/reset-form";

export async function ResetPasswordView({
  searchParams,
}: PageProps<"/reset-password">) {
  const [session, { token }] = await Promise.all([
    getSessionUser(),
    searchParams,
  ]);

  const footer = (
    <>
      链接已失效？{" "}
      <Link href="/forgot-password" className="hover:text-fg underline">
        重新申请
      </Link>
    </>
  );

  if (typeof token !== "string" || token.length === 0) {
    return (
      <AuthShell footer={footer}>
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm leading-6">
          链接不完整。
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={footer}>
      {session ? (
        <p className="text-warn bg-warn-subtle mb-4 rounded-md px-3 py-2 text-sm leading-6">
          已登录为 <span className="font-mono">{session.username}</span>
          ，重置该账号密码会退出登录。
        </p>
      ) : null}
      <ResetForm token={token} />
    </AuthShell>
  );
}
