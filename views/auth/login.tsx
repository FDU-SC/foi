import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { FormMessage } from "@/components/form";

export async function LoginView({ searchParams }: PageProps<"/login">) {
  if (await getSessionUser()) redirect("/");

  const { next, changed } = await searchParams;
  const target = typeof next === "string" ? next : "/";

  return (
    <AuthShell
      footer={
        <>
          还没有账号？{" "}
          <Link href="/register" className="hover:text-fg underline">
            注册
          </Link>
          。忘记密码？{" "}
          <Link href="/forgot-password" className="hover:text-fg underline">
            用邮箱找回
          </Link>
          。
        </>
      }
    >
      {changed === "1" ? (
        <div className="mb-4">
          <FormMessage tone="ok">密码已更新，请用新密码重新登录。</FormMessage>
        </div>
      ) : null}
      <LoginForm next={target} />
    </AuthShell>
  );
}
