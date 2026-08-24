"use server";

import { z } from "zod";
import { findAccountByEmail, getAccount } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { normalizeEmail } from "@/lib/accounts/types";
import { sendPasswordReset } from "@/lib/mail/notify";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export interface ForgotState {
  error?: string;
  message?: string;
}

const schema = z.object({
  identifier: z.string().trim().min(1, "请填写用户名或邮箱"),
});

/**
 * The same sentence comes back whether or not the account exists, whether or
 * not it has an address on file, and whether or not a link was actually sent.
 * Anything else turns this form into a way to test whether a given person has
 * an account here.
 *
 * The account is looked up by whichever of the two the person typed. Login is
 * by handle, so that is what they are likely to remember; the address is what
 * the mail goes to, so that is what they may have typed instead.
 */
const SENT = "如果该账号存在且已验证邮箱，我们已经发送了重置链接，请查收。";

export async function requestPasswordReset(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const parsed = schema.safeParse({ identifier: formData.get("identifier") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const limit = rateLimit(`forgot:${await clientIp()}`, 10, 60 * 60 * 1000);
  if (!limit.ok) {
    return { error: "请求过于频繁，请稍后再试。" };
  }

  const { identifier } = parsed.data;
  const row = identifier.includes("@")
    ? await findAccountByEmail(normalizeEmail(identifier))
    : await getAccount(identifier);

  if (row) {
    const user = resolveFromRow(row);
    // Registration proves the address before it writes the row, so this now
    // only excludes bootstrap accounts — which have no address to mail — and
    // anyone suspended. It stays an explicit check rather than an assumption
    // about how every row got there.
    if (!user.disabled && user.email && user.emailVerified) {
      // A throttled resend is reported as success: the person already has a
      // live link in their inbox, and saying so would leak that they exist.
      await sendPasswordReset({
        handle: user.handle,
        displayName: user.displayName,
        email: user.email,
      });
    }
  }

  return { message: SENT };
}
