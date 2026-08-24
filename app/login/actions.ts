"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export interface LoginState {
  error?: string;
}

/**
 * Rate limiting is not here but in the `authorize` callback, which is the only
 * point every attempt passes through: posting straight to
 * `/api/auth/callback/credentials` skips this action entirely. A refused
 * attempt therefore comes back as an ordinary credential failure.
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const next = String(formData.get("next") || "/");

  try {
    await signIn("credentials", {
      handle: String(formData.get("handle") ?? ""),
      password: String(formData.get("password") ?? ""),
      // Only allow same-site destinations so `?next=` cannot bounce elsewhere.
      redirectTo: next.startsWith("/") && !next.startsWith("//") ? next : "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "用户名或密码错误" };
    }
    // signIn signals success by throwing NEXT_REDIRECT; let it through.
    throw error;
  }

  return {};
}
