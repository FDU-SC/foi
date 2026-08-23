import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "找回密码" };

export default async function ForgotPasswordPage() {
  if (await getSessionUser()) redirect("/");

  return (
    <AuthShell
      footer={
        <>
          想起来了？直接{" "}
          <Link href="/login" className="hover:text-fg underline">
            登录
          </Link>
          。
          <br />
          账号没有邮箱时请联系管理员。
        </>
      }
    >
      <ForgotForm />
    </AuthShell>
  );
}
