import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import {
  SELF_SERVICE_OFF,
  selfServiceEnabled,
} from "@/lib/accounts/self-service";
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
          {selfServiceEnabled
            ? "账号没有邮箱时请联系管理员。"
            : "需要改密码请联系管理员。"}
        </>
      }
    >
      {selfServiceEnabled ? (
        <ForgotForm />
      ) : (
        <p className="text-warn bg-warn-subtle rounded-md px-3 py-2 text-sm leading-6">
          {SELF_SERVICE_OFF}
        </p>
      )}
    </AuthShell>
  );
}
