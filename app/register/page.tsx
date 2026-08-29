import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { registrationOpen } from "@/lib/enrollment/register";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { verifyToken } from "@/lib/tokens/stateless";
import { RegisterForm } from "./register-form";
import { SendLinkForm } from "./send-link-form";

export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getSessionUser()) redirect("/");

  if (!registrationOpen()) {
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
  const { token } = await searchParams;

  const payload = token ? verifyToken(token, "email-verify") : null;
  const verifiedEmail = payload?.s;

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
      {verifiedEmail ? (
        <RegisterForm email={verifiedEmail} token={token!} />
      ) : (
        <SendLinkForm invalidToken={!!token} />
      )}
    </AuthShell>
  );
}
