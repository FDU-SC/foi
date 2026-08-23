import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  if (await getSessionUser()) redirect("/");

  const { next } = await searchParams;
  const target = typeof next === "string" ? next : "/";

  return (
    <AuthShell
      footer={
        <>
          忘记密码？{" "}
          <Link href="/forgot-password" className="hover:text-fg underline">
            用邮箱找回
          </Link>
          。
          <br />
          第一次登录且拿到了设置码，请到{" "}
          <Link href="/setup" className="hover:text-fg underline">
            设置密码
          </Link>
          。
        </>
      }
    >
      <LoginForm next={target} />
    </AuthShell>
  );
}
