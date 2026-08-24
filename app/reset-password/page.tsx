import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "重置密码" };

/**
 * The one page in `AuthShell` that a signed-in person may legitimately be on.
 *
 * The others send them home, and this used to as well — which threw the token
 * away without saying so, so the link read as broken to anybody still logged
 * in on this browser. That is not a rare accident: resetting a password is
 * what somebody does *because* they think a session was taken, and
 * `getResolvedUser` ends every session issued against the old password,
 * including the one making this request. Being signed in here is the ordinary
 * case, not a mistake to be corrected.
 */
export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const [session, { token }] = await Promise.all([
    getSessionUser(),
    searchParams,
  ]);

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
      {/*
        Hedged, because this page genuinely does not know whose link it is —
        finding out would mean reading the token, and reading it on GET is the
        thing the comment above refuses to do. The common case is the same
        person, and saying "you will be signed out" flatly would be a lie to
        whoever is resetting a second account from a shared browser.
      */}
      {session ? (
        <p className="text-warn bg-warn-subtle mb-4 rounded-md px-3 py-2 text-sm leading-6">
          你正以 <span className="font-mono">{session.handle}</span>{" "}
          登录。若这个链接就是这个账号的，设置新密码后当前会话会立即失效，需要重新登录。
        </p>
      ) : null}
      <ResetForm token={token} />
    </AuthShell>
  );
}
