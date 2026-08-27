"use server";

import { z } from "zod";
import { findAccountByEmail, getAccount } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { normalizeEmail } from "@/lib/accounts/types";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { sendPasswordReset, type Recipient } from "@/lib/mail/notify";
import { rateLimitByCaller } from "@/lib/ratelimit";
import { ACTION_LIMITS, fixedRule } from "@/lib/ratelimit/policy";

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

  // Read off `ACTION_LIMITS` rather than written here: a bound kept in both
  // places drifts into a table documenting a limit nobody enforces.
  //
  // With no trusted proxy in front there is no source to count and this stands
  // aside entirely — see `rateLimitBySource`. What still holds then is the
  // durable per-recipient cooldown in `lib/accounts/tokens.ts`: one link per
  // account per minute, which bounds what any single mailbox can be made to
  // receive but not how many mailboxes can be aimed at in an hour.
  const rule = fixedRule(ACTION_LIMITS.requestPasswordReset);
  const limit = await rateLimitByCaller(
    "forgot",
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limit.ok) {
    return { error: "请求过于频繁，请稍后再试。" };
  }

  const { identifier } = parsed.data;
  const row = identifier.includes("@")
    ? await findAccountByEmail(
        // Must be the same normalisation registration used to decide what to
        // store, options and all: `normalizeEmail`'s own default for
        // sub-addresses is *off* while the policy's is on, so calling it bare
        // here leaves somebody who signed up as `user+tag@d` — on file as
        // `user@d` — matching no row, with the uniform sentence below giving
        // them nothing to work out why.
        normalizeEmail(identifier, {
          stripSubaddress: enrollmentPolicy.stripSubaddress,
        }),
      )
    : await getAccount(identifier);

  if (row) {
    const user = resolveFromRow(row);
    // Registration proves the address before it writes the row, so this now
    // only excludes bootstrap accounts — which have no address to mail — and
    // anyone suspended. It stays an explicit check rather than an assumption
    // about how every row got there.
    if (!user.disabled && user.email && user.emailVerified) {
      await notifyQuietly({
        handle: user.handle,
        displayName: user.displayName,
        email: user.email,
      });
    }
  }

  return { message: SENT };
}

/**
 * Sends the link and tells nobody but the log what came of it.
 *
 * Every outcome — sent, still in its resend cooldown, relay unreachable — is
 * the same `SENT` sentence to the browser, because anything else reintroduces
 * the account probe from a different angle. A throttle answering "wait 40
 * seconds" confirms the account exists; so does a 500 from an unreachable
 * relay, which is why the catch is not optional here.
 *
 * The cost is that "no mail was sent" and "mail was sent" are one event from
 * outside, so the log is the only place they can be told apart — the
 * difference between an operator diagnosing a broken relay in a minute and
 * reading it as a user who mistyped their address. Hence a distinct line per
 * outcome below.
 */
async function notifyQuietly(to: Recipient): Promise<void> {
  try {
    const result = await sendPasswordReset(to);
    if (result.ok) {
      console.log(`[foi] 找回密码: 已向 ${to.handle} 发出重置链接`);
    } else {
      console.log(
        `[foi] 找回密码: ${to.handle} 仍在重发冷却中，本次未发送` +
          `（还需 ${Math.ceil(result.retryAfterMs / 1000)} 秒），对外仍回同一句话`,
      );
    }
  } catch (error) {
    console.error(`[foi] 找回密码: 向 ${to.handle} 投递重置邮件失败`, error);
  }
}
