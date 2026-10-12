import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotForm } from "@/components/auth/forgot-form";

export async function ForgotPasswordView() {
  if (await getSessionUser()) redirect("/");

  return (
    <AuthShell
      footer={
        <>
          返回{" "}
          <Link href="/login" className="hover:text-fg underline">
            登录
          </Link>
          。
        </>
      }
    >
      <ForgotForm />
    </AuthShell>
  );
}
