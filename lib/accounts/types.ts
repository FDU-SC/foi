import { z } from "zod";
import type { AccountStatus } from "@/lib/db/schema";

const HANDLE_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const handleSchema = z
  .string()
  .min(2, "用户名至少 2 个字符")
  .max(32, "用户名最多 32 个字符")
  .regex(HANDLE_PATTERN, "用户名只能包含字母、数字、下划线和连字符");

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .pipe(z.email("请填写有效的邮箱地址"));

export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
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
  handle: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  groups: string[];
  status: AccountStatus;

  disabled: boolean;
}
