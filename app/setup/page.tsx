import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "设置密码" };

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  if (await getSessionUser()) redirect("/");

  const { handle, token } = await searchParams;

  return (
    <AuthShell
      footer={
        <>
          这个页面用于管理员签发的设置码。
          <br />
          忘记密码请走{" "}
          <Link href="/forgot-password" className="hover:text-fg underline">
            邮箱找回
          </Link>
          ，已有密码请直接{" "}
          <Link href="/login" className="hover:text-fg underline">
            登录
          </Link>
          。
        </>
      }
    >
      <SetupForm
        handle={typeof handle === "string" ? handle : ""}
        code={typeof token === "string" ? token : ""}
      />
    </AuthShell>
  );
}
