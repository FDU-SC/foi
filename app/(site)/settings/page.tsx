import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { FormMessage } from "@/components/form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getAccount } from "@/lib/accounts/queries";
import {
  USERNAME_CHANGE_COOLDOWN_DAYS,
  usernameChangeAvailableAt,
} from "@/lib/accounts/username";
import { authorize } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { site } from "@/lib/site";
import { EmailChangeForm } from "./email/email-change-form";
import { NicknameForm } from "./nickname-form";
import { PasswordForm } from "./password-form";
import { UsernameForm } from "./username-form";

export const metadata: Metadata = { title: "个人设置" };

export const dynamic = "force-dynamic";

function formatMoment(at: Date): string {
  return new Intl.DateTimeFormat(site.lang, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: site.timezone,
  }).format(at);
}

function usernameHint(changedAt: Date | null): string {
  const availableAt = usernameChangeAvailableAt(changedAt);

  if (availableAt && availableAt.getTime() > Date.now()) {
    return `已在冷却中，${formatMoment(availableAt)} 之后才能再次修改。`;
  }

  return `登录时使用，只能包含字母、数字、下划线和连字符。每 ${USERNAME_CHANGE_COOLDOWN_DAYS} 天只能修改一次。`;
}

/** Stands in for a form the viewer may not submit. */
function Unavailable({ children }: { children: string }) {
  return <p className="text-fg-muted text-sm leading-6">{children}</p>;
}

export default async function SettingsPage({
  searchParams,
}: PageProps<"/settings">) {
  const user = await getResolvedUser();
  if (!user) redirect("/login");

  const { password } = await searchParams;
  const account = await getAccount(user.uid);

  // Presentation only — every form's action asks again through `requireSelf`.
  // Rendering a form nobody may submit would answer the click with the generic
  // error boundary instead of the reason the policy already carries.
  const viewer = viewerFor(user);
  const nicknameGate = authorize("account.changeNickname", user, viewer);
  const usernameGate = authorize("account.changeUsername", user, viewer);
  const emailGate = authorize("account.changeEmail", user, viewer);
  const passwordGate = authorize("account.changePassword", user, viewer);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">个人设置</h1>
        <p className="text-fg-muted mt-2 text-sm leading-6">
          管理你的账号资料与登录凭据。
        </p>
      </div>

      <Card>
        <CardHeader title="昵称" />
        <CardBody>
          {nicknameGate.allow ? (
            <NicknameForm current={user.nickname} />
          ) : (
            <Unavailable>{nicknameGate.reason.message}</Unavailable>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="用户名" />
        <CardBody>
          {usernameGate.allow ? (
            <UsernameForm
              current={user.username}
              hint={usernameHint(account?.usernameChangedAt ?? null)}
            />
          ) : (
            <Unavailable>{usernameGate.reason.message}</Unavailable>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="邮箱" />
        <CardBody className="space-y-4">
          <div className="bg-surface-2 rounded-md px-4 py-3">
            <p className="text-fg-muted text-xs">当前邮箱</p>
            <p className="text-fg mt-0.5 font-mono text-sm">
              {user.email ?? "未设置"}
            </p>
          </div>
          {!emailGate.allow ? (
            <Unavailable>{emailGate.reason.message}</Unavailable>
          ) : user.email ? (
            <>
              <p className="text-fg-muted text-sm leading-6">
                验证链接会发到新邮箱，确认后才会生效。修改邮箱后，你的用户组归属会根据新邮箱重新计算。
              </p>
              <EmailChangeForm />
            </>
          ) : (
            <Unavailable>当前账号没有设置邮箱，无法使用修改邮箱功能。</Unavailable>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="密码" />
        <CardBody className="space-y-4">
          {password === "updated" ? (
            <FormMessage tone="ok">
              密码已更新，其他设备上的登录状态已全部失效。
            </FormMessage>
          ) : null}
          {passwordGate.allow ? (
            <PasswordForm minLength={site.passwordMinLength ?? 8} />
          ) : (
            <Unavailable>{passwordGate.reason.message}</Unavailable>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
