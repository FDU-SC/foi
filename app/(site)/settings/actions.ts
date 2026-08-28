"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getResolvedUser, signIn } from "@/auth";
import { setPassword, verifyPassword } from "@/lib/accounts/password";
import {
  SELF_SERVICE_OFF,
  selfServiceEnabled,
} from "@/lib/accounts/self-service";
import {
  getAccount,
  getAccountByUsername,
  updateNickname,
  updateUsername,
} from "@/lib/accounts/queries";
import type { ResolvedUser } from "@/lib/accounts/types";
import { nicknameSchema, usernameSchema } from "@/lib/accounts/types";
import {
  USERNAME_CHANGE_COOLDOWN_DAYS,
  usernameChangeAvailableAt,
} from "@/lib/accounts/username";
import { sendSecurityNotice } from "@/lib/mail/notify";
import type { SecurityChangeKind } from "@/lib/mail/types";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import { site } from "@/lib/site";

export interface SettingsState {
  error?: string;
  message?: string;
}

const TOO_MANY = "操作过于频繁，请稍后再试。";
const WRONG_PASSWORD = "当前密码不正确。";

function within(activity: string, uid: number, rule: { max: number; windowSeconds: number }): boolean {
  return rateLimit(`${activity}:${uid}`, rule.max, rule.windowSeconds * 1000).ok;
}

function formatMoment(at: Date): string {
  return new Intl.DateTimeFormat(site.lang, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: site.timezone,
  }).format(at);
}

/**
 * The change already happened; a failed notice must never surface as a failed action.
 */
async function notify(
  user: ResolvedUser,
  kind: SecurityChangeKind,
  detail?: string,
): Promise<void> {
  if (!user.email) return;

  try {
    await sendSecurityNotice(
      { uid: user.uid, nickname: user.nickname, email: user.email },
      kind,
      detail,
    );
  } catch (error) {
    console.error("[foi] 安全变更通知邮件发送失败", error);
  }
}

const nicknameForm = z.object({ nickname: nicknameSchema });

export async function updateNicknameAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (!selfServiceEnabled) return { error: SELF_SERVICE_OFF };

  const viewer = await getResolvedUser();
  if (!viewer) redirect("/login");

  const parsed = nicknameForm.safeParse({ nickname: formData.get("nickname") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const { nickname } = parsed.data;
  if (nickname === viewer.nickname) {
    return { error: "新昵称和当前昵称相同。" };
  }

  if (!within("settings:nickname", viewer.uid, ACTION_LIMITS.updateNicknameAction)) {
    return { error: TOO_MANY };
  }

  const updated = await updateNickname(viewer.uid, nickname);
  if (!updated) return { error: "更新失败，请重试。" };

  return { message: `昵称已更新为 ${nickname}。` };
}

const usernameForm = z.object({
  username: usernameSchema,
  currentPassword: z.string().min(1, "请输入当前密码"),
});

export async function updateUsernameAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (!selfServiceEnabled) return { error: SELF_SERVICE_OFF };

  const viewer = await getResolvedUser();
  if (!viewer) redirect("/login");

  const parsed = usernameForm.safeParse({
    username: formData.get("username"),
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const { username, currentPassword } = parsed.data;
  if (username === viewer.username) {
    return { error: "新用户名和当前用户名相同。" };
  }

  if (!within("settings:username", viewer.uid, ACTION_LIMITS.updateUsernameAction)) {
    return { error: TOO_MANY };
  }

  const account = await getAccount(viewer.uid);
  if (!account) return { error: "更新失败，请重试。" };

  const availableAt = usernameChangeAvailableAt(account.usernameChangedAt);
  if (availableAt && availableAt.getTime() > Date.now()) {
    return {
      error:
        `用户名每 ${USERNAME_CHANGE_COOLDOWN_DAYS} 天只能修改一次，` +
        `${formatMoment(availableAt)} 之后才能再次修改。`,
    };
  }

  if (!(await verifyPassword(viewer.uid, currentPassword)).ok) {
    return { error: WRONG_PASSWORD };
  }

  const taken = await getAccountByUsername(username);
  if (taken && taken.uid !== viewer.uid) {
    return { error: "这个用户名已被占用，换一个试试。" };
  }

  const result = await updateUsername(viewer.uid, username);
  if (!result.ok) {
    return {
      error:
        result.reason === "taken"
          ? "这个用户名已被占用，换一个试试。"
          : "更新失败，请重试。",
    };
  }

  await notify(viewer, "username", `新用户名：${username}`);

  return { message: `用户名已更新为 ${username}，下次登录请使用新用户名。` };
}

const MIN_PASSWORD = site.passwordMinLength ?? 8;

const passwordForm = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    password: z.string().min(MIN_PASSWORD, `密码至少 ${MIN_PASSWORD} 位`),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  })
  .refine((data) => data.password !== data.currentPassword, {
    path: ["password"],
    message: "新密码不能和当前密码相同",
  });

export async function changePasswordAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (!selfServiceEnabled) return { error: SELF_SERVICE_OFF };

  const viewer = await getResolvedUser();
  if (!viewer) redirect("/login");

  const parsed = passwordForm.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  if (!within("settings:password", viewer.uid, ACTION_LIMITS.changePasswordAction)) {
    return { error: TOO_MANY };
  }

  const { currentPassword, password } = parsed.data;

  if (!(await verifyPassword(viewer.uid, currentPassword)).ok) {
    return { error: WRONG_PASSWORD };
  }

  await setPassword(viewer.uid, password);

  await notify(viewer, "password");

  // setPassword bumped password_set_at, so every JWT — including this tab's — is now stale.
  let reissued = false;
  try {
    await signIn("credentials", {
      identifier: viewer.username,
      password,
      redirect: false,
    });
    reissued = true;
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    console.error("[foi] 改密后自动重新登录失败", error);
  }

  // signIn put the new session on the *response*. Re-rendering here would still read
  // the stale JWT off this request and bounce to /login, so hand the browser a fresh GET.
  redirect(reissued ? "/settings?password=updated" : "/login?changed=1");
}
