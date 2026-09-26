import { z } from "zod";
import type { AccountStatus } from "@/lib/db/schema";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const usernameSchema = z
  .string()
  .min(2, "用户名至少 2 个字符")
  .max(32, "用户名最多 32 个字符")
  .regex(USERNAME_PATTERN, "用户名只能包含字母、数字、下划线和连字符");

export const nicknameSchema = z
  .string()
  .trim()
  .min(1, "请填写昵称")
  .max(64, "昵称过长");

export const BIO_MAX_LENGTH = 200;

/** An empty bio clears it. */
export const bioSchema = z
  .string()
  .trim()
  .max(BIO_MAX_LENGTH, `简介最多 ${BIO_MAX_LENGTH} 个字符`)
  .transform((bio) => bio || null);

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .pipe(z.email("请填写有效的邮箱地址"));

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizeEmail(
  email: string,
  options?: { stripSubaddress?: boolean },
): string {
  const trimmed = email.trim().toLowerCase();
  if (!options?.stripSubaddress) return trimmed;

  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  const [local] = trimmed.slice(0, at).split("+");

  return local ? `${local}${trimmed.slice(at)}` : trimmed;
}

export interface ResolvedUser {
  uid: number;
  username: string;
  nickname: string;
  avatarUpdatedAt: Date | null;
  email: string | null;
  emailVerified: boolean;
  groups: string[];
  status: AccountStatus;

  disabled: boolean;
}
