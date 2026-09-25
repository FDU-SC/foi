import { redirect } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { AvatarEditor } from "@/components/account/avatar-editor";
import { FormMessage } from "@/components/form";
import { EmailChangeForm } from "@/components/settings/email-change-form";
import { NicknameForm } from "@/components/settings/nickname-form";
import { PasswordForm } from "@/components/settings/password-form";
import { UsernameForm } from "@/components/settings/username-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getAccount } from "@/lib/accounts/queries";
import {
  USERNAME_CHANGE_COOLDOWN_DAYS,
  usernameChangeAvailableAt,
} from "@/lib/accounts/username";
import { authorize } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { site } from "@/lib/site";

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
    return `可在 ${formatMoment(availableAt)} 之后再次修改。`;
  }

  return `字母、数字、下划线或连字符，每 ${USERNAME_CHANGE_COOLDOWN_DAYS} 天可改一次。`;
}

/** Stands in for a form the viewer may not submit. */
function Unavailable({ children }: { children: string }) {
  return <p className="text-fg-muted text-sm leading-6">{children}</p>;
}

export async function SettingsView({ searchParams }: PageProps<"/settings">) {
  const user = await getResolvedUser();
  if (!user) redirect("/login");

  const { password } = await searchParams;
  const account = await getAccount(user.uid);

  // Presentation only — every form's action asks again through `requireSelf`.
  // Rendering a form nobody may submit would answer the click with the generic
  // error boundary instead of the reason the policy already carries.
  const viewer = viewerFor(user);
  const nicknameGate = authorize("account.changeNickname", user, viewer);
  const avatarGate = authorize("account.changeAvatar", user, viewer);
  const usernameGate = authorize("account.changeUsername", user, viewer);
  const emailGate = authorize("account.changeEmail", user, viewer);
  const passwordGate = authorize("account.changePassword", user, viewer);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-fg text-2xl font-bold tracking-tight">个人设置</h1>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="min-w-0 space-y-4">
          <h2 className="text-sm font-semibold">个人资料</h2>
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
            <CardHeader title="头像" />
            <CardBody>
              {avatarGate.allow ? (
                <AvatarEditor current={user} withControls />
              ) : (
                <Unavailable>{avatarGate.reason.message}</Unavailable>
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
        </section>
        <section className="min-w-0 space-y-4">
          <h2 className="text-sm font-semibold">账号安全</h2>
          <Card>
            <CardHeader title="邮箱" />
            <CardBody className="space-y-4">
              <p className="bg-surface-2 text-fg rounded-md px-4 py-3 font-mono text-sm">
                {user.email ?? "未设置"}
              </p>
              {!emailGate.allow ? (
                <Unavailable>{emailGate.reason.message}</Unavailable>
              ) : user.email ? (
                <EmailChangeForm />
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="密码" />
            <CardBody className="space-y-4">
              {password === "updated" ? (
                <FormMessage tone="ok">
                  密码已更新，其他设备已退出登录。
                </FormMessage>
              ) : null}
              {passwordGate.allow ? (
                <PasswordForm minLength={site.passwordMinLength ?? 8} />
              ) : (
                <Unavailable>{passwordGate.reason.message}</Unavailable>
              )}
            </CardBody>
          </Card>
        </section>
      </div>
    </div>
  );
}
