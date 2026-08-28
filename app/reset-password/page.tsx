import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import {
  SELF_SERVICE_OFF,
  selfServiceEnabled,
} from "@/lib/accounts/self-service";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "重置密码" };

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const [session, { token }] = await Promise.all([
    getSessionUser(),
    searchParams,
  ]);

  if (!selfServiceEnabled) {
    return (
      <AuthShell
        footer={
          <>
            回到{" "}
            <Link href="/login" className="hover:text-fg underline">
              登录
            </Link>
            。
          </>
        }
      >
        <p className="text-warn bg-warn-subtle rounded-md px-3 py-2 text-sm leading-6">
          {SELF_SERVICE_OFF}
        </p>
      </AuthShell>
    );
  }

  if (typeof token !== "string" || token.length === 0) {
    return (
      <AuthShell
        footer={
          <>
            需要一封新的重置邮件？{" "}
            <Link href="/forgot-password" className="hover:text-fg underline">
              重新申请
            </Link>
            。
          </>
        }
      >
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm leading-6">
          链接不完整。请直接点击邮件中的按钮，或把完整地址复制到浏览器。
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      footer={
        <>
          链接已失效？{" "}
          <Link href="/forgot-password" className="hover:text-fg underline">
            重新申请
          </Link>
          。
        </>
      }
    >

      {session ? (
        <p className="text-warn bg-warn-subtle mb-4 rounded-md px-3 py-2 text-sm leading-6">
          你正以 <span className="font-mono">{session.username}</span>{" "}
          登录。若这个链接就是这个账号的，设置新密码后当前会话会立即失效，需要重新登录。
        </p>
      ) : null}
      <ResetForm token={token} />
    </AuthShell>
  );
}
