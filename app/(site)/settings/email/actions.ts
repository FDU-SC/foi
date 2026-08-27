"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getResolvedUser } from "@/auth";
import { getEmailFingerprint } from "@/lib/accounts/password";
import { findAccountByEmail } from "@/lib/accounts/queries";
import { invalidateAccounts } from "@/lib/accounts/cache";
import { emailSchema, normalizeEmail } from "@/lib/accounts/types";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { sendEmailChangeLink } from "@/lib/mail/notify";
import { rateLimitBySource, sourceFrom } from "@/lib/ratelimit";
import { verifyToken } from "@/lib/tokens/stateless";

export interface EmailChangeState {
  error?: string;
  message?: string;
}

const emailChangeSchema = z.object({
  newEmail: emailSchema,
});

export async function requestEmailChangeAction(
  _prev: EmailChangeState,
  formData: FormData,
): Promise<EmailChangeState> {
  const viewer = await getResolvedUser();
  if (!viewer) redirect("/login");

  const parsed = emailChangeSchema.safeParse({
    newEmail: formData.get("newEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "请填写有效的邮箱地址" };
  }

  const newEmail = normalizeEmail(parsed.data.newEmail, {
    stripSubaddress: enrollmentPolicy.stripSubaddress,
  });

  if (!viewer.email) {
    return { error: "当前账号没有设置邮箱。" };
  }

  if (newEmail === viewer.email) {
    return { error: "新邮箱和当前邮箱相同。" };
  }

  if (await findAccountByEmail(newEmail)) {
    return { error: "这个邮箱已被其他账号使用。" };
  }

  const limit = rateLimitBySource(
    "email-change",
    sourceFrom(await headers()),
    5,
    60 * 60 * 1000,
  );
  if (!limit.ok) {
    return { error: "请求过于频繁，请稍后再试。" };
  }

  const fp = await getEmailFingerprint(viewer.uid);
  if (!fp) {
    return { error: "当前账号没有设置邮箱。" };
  }

  try {
    await sendEmailChangeLink(
      { uid: viewer.uid, nickname: viewer.nickname, email: viewer.email },
      newEmail,
      fp,
    );
  } catch (error) {
    console.error("[foi] 换绑邮箱邮件发送失败", error);
    return { error: "邮件发送失败，请稍后再试。" };
  }

  return { message: `验证链接已发送到 ${newEmail}，请查收并点击确认。` };
}

export interface ConfirmEmailChangeState {
  error?: string;
  message?: string;
}

export async function confirmEmailChangeAction(
  token: string,
): Promise<ConfirmEmailChangeState> {
  const viewer = await getResolvedUser();
  if (!viewer) redirect("/login");

  const payload = verifyToken(token, "email-change");
  if (!payload) {
    return { error: "链接无效或已过期，请重新申请。" };
  }

  if (payload.s !== String(viewer.uid)) {
    return { error: "此链接不属于当前登录的账号。" };
  }

  const data = payload.d as { newEmail: string } | undefined;
  if (!data?.newEmail) {
    return { error: "链接数据不完整。" };
  }

  const fp = await getEmailFingerprint(viewer.uid);
  if (!fp || fp !== payload.fp) {
    return { error: "链接已失效（邮箱已被修改），请重新申请。" };
  }

  if (await findAccountByEmail(data.newEmail)) {
    return { error: "目标邮箱已被其他账号使用。" };
  }

  const [updated] = await db
    .update(accounts)
    .set({ email: data.newEmail, updatedAt: sql`now()` })
    .where(eq(accounts.uid, viewer.uid))
    .returning({ uid: accounts.uid });

  if (!updated) {
    return { error: "更新失败，请重试。" };
  }

  invalidateAccounts();
  return { message: `邮箱已更新为 ${data.newEmail}。` };
}
