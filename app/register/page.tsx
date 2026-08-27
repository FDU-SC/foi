import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import {
  codeTtlMinutes,
  resendCooldownMs,
} from "@/lib/enrollment/email-verification";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage() {
  if (await getSessionUser()) redirect("/");

  if (!enrollmentPolicy.enabled) {
    return (
      <AuthShell
        footer={
          <>
            已有账号？{" "}
            <Link href="/login" className="hover:text-fg underline">
              登录
            </Link>
            。
          </>
        }
      >
        <p className="text-fg-muted bg-surface-2 rounded-md px-3 py-2 text-sm leading-6">
          当前未开放注册。如需账号，请联系管理员。
        </p>
      </AuthShell>
    );
  }

  const domains = enrollmentPolicy.emailDomains;

  return (
    <AuthShell
      footer={
        <>
          {domains.length > 0 ? (
            <>
              仅接受
              {domains.map((domain, index) => (
                <span key={domain}>
                  {index > 0 ? "、" : " "}
                  <span className="text-fg-muted font-mono">@{domain}</span>
                </span>
              ))}{" "}
              邮箱。
              <br />
            </>
          ) : null}
          已有账号？{" "}
          <Link href="/login" className="hover:text-fg underline">
            登录
          </Link>
          。
        </>
      }
    >
      <RegisterForm
        codeTtlMinutes={codeTtlMinutes}
        resendCooldownMs={resendCooldownMs}
      />
    </AuthShell>
  );
}
