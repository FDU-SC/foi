import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "重置密码" };

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  if (await getSessionUser()) redirect("/");

  const { token } = await searchParams;

  // The token is not checked here, only carried into the form. Validating on
  // GET would spend it — mail clients and link scanners fetch these — so the
  // only thing that consumes it is the POST that also sets the password.
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
      <ResetForm token={token} />
    </AuthShell>
  );
}
