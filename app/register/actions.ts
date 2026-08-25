"use server";

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { z } from "zod";
import { signIn } from "@/auth";
import { findAccountByEmail } from "@/lib/accounts/queries";
import {
  emailSchema,
  handleSchema,
  normalizeEmail,
} from "@/lib/accounts/types";
import { maxAttempts, verifyCode } from "@/lib/auth/email-verification";
import {
  checkRegistrationProof,
  issueRegistrationProof,
  REGISTRATION_PROOF_COOKIE,
  registrationProofCookieOptions,
} from "@/lib/auth/registration-proof";
import {
  domainAllowed,
  register,
  type RegisterRejection,
} from "@/lib/enrollment/register";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { sendVerificationCode } from "@/lib/mail/notify";
import { rateLimitByCaller } from "@/lib/ratelimit";

/**
 * Registration in three steps, because proving the address now comes first.
 *
 * The account is created last and created active. Nothing exists until the
 * code has been typed back, which is what removes the half-made account the
 * old link flow left behind whenever somebody never clicked.
 *
 * Sending and checking the code are separate calls rather than fields on the
 * final submit. Folding them in would mean a username collision — discovered
 * only at the end — also burns the code, sending someone back to their inbox
 * for a mistake that has nothing to do with their address.
 */
function normalize(email: string): string {
  return normalizeEmail(email, {
    stripSubaddress: enrollmentPolicy.stripSubaddress,
  });
}

export interface SendCodeState {
  error?: string;
  /** Set once a code is on its way; the form switches to asking for it. */
  sentTo?: string;
}

/**
 * Says plainly when an address is already registered, for the same reason the
 * form names a taken username: the alternative is somebody waiting on an email
 * that was never going to arrive, with no way to work out why. Password
 * recovery is the actionable answer and this is where to point at it.
 */
export async function sendCodeAction(
  rawEmail: string,
): Promise<SendCodeState> {
  if (!enrollmentPolicy.enabled) return { error: "当前未开放注册。" };

  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "请填写有效的邮箱地址" };
  }

  const email = normalize(parsed.data);

  if (!domainAllowed(email)) {
    return { error: "这个邮箱域名不在允许注册的范围内。" };
  }
  if (await findAccountByEmail(email)) {
    return { error: "这个邮箱已经注册过了。如果是你本人，请用「找回密码」。" };
  }

  const limit = await rateLimitByCaller(
    "send-code",
    enrollmentPolicy.registrationsPerIpPerHour,
    60 * 60 * 1000,
  );
  if (!limit.ok) return { error: "请求过于频繁，请稍后再试。" };

  try {
    const result = await sendVerificationCode(email);
    if (!result.ok) {
      return {
        error: `验证码刚刚发过，请 ${Math.ceil(result.retryAfterMs / 1000)} 秒后再试。`,
      };
    }
  } catch (error) {
    console.error("[foi] 验证码邮件发送失败", error);
    return { error: "邮件发送失败，请稍后再试或联系管理员。" };
  }

  return { sentTo: email };
}

export interface VerifyState {
  error?: string;
  verified?: boolean;
}

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "验证码是 6 位数字");

const VERIFY_FAILURES = {
  "no-code": "还没有向这个邮箱发送过验证码，请先获取验证码。",
  expired: "验证码已过期，请重新获取。",
  "too-many-attempts": "错误次数过多，这个验证码已作废，请重新获取。",
} as const;

export async function verifyCodeAction(
  rawEmail: string,
  rawCode: string,
): Promise<VerifyState> {
  // Closed means closed at every step, not only at the two ends. A code issued
  // just before the flag flipped is still verifiable, so without this somebody
  // types it in, is told the address is proven, is handed a proof cookie, and
  // only discovers at submit that there was never going to be an account.
  if (!enrollmentPolicy.enabled) return { error: "当前未开放注册。" };

  const email = emailSchema.safeParse(rawEmail);
  const code = codeSchema.safeParse(rawCode);

  if (!email.success) return { error: "邮箱地址不合法" };
  if (!code.success) {
    return { error: code.error.issues[0]?.message ?? "验证码不合法" };
  }

  // The per-address attempt cap is what actually protects a six-digit code;
  // this only bounds how much traffic one source can aim at the endpoint, and
  // is sized at every guess an IP could legitimately need — one full set of
  // attempts for each registration it is allowed in an hour. That division of
  // labour is also what makes standing this one aside safe when there is no
  // source: `verifyCode` still burns the code after `maxAttempts` wrong
  // guesses at it, whoever is guessing.
  const limit = await rateLimitByCaller(
    "verify-code",
    enrollmentPolicy.registrationsPerIpPerHour * maxAttempts,
    60 * 60 * 1000,
  );
  if (!limit.ok) return { error: "请求过于频繁，请稍后再试。" };

  const address = normalize(email.data);
  const result = await verifyCode(address, code.data);
  if (result.ok) {
    const jar = await cookies();

    // The cookie is the half `isEmailVerified` cannot be: it names *this*
    // browser as the one that typed the code. HttpOnly so a script on the
    // page cannot lift it; SameSite=lax so a cross-site POST cannot spend it.
    //
    // Gated on `matched`, and that is the whole of the binding. `verifyCode`
    // also answers `ok` for an address a *previous* call proved, without
    // comparing anything — minting a proof on that answer handed one to
    // anybody who submitted a wrong code while somebody else's address was
    // inside its 30-minute window, and a proof plus the verified row is the
    // entire gate `register` checks.
    if (result.matched) {
      jar.set(
        REGISTRATION_PROOF_COOKIE,
        issueRegistrationProof(address),
        registrationProofCookieOptions(),
      );
      return { verified: true };
    }

    // Nothing was compared, so this call says nothing about who is asking; the
    // cookie already in hand is the only thing that can. A browser holding one
    // is somebody pressing the button a second time and gets the same answer
    // as before. Anyone else — a stranger, or a person whose cookie went
    // missing — is told to start over, which from here is the only thing that
    // works: answering `verified` would send them to a submit that can only
    // come back `email-unverified`.
    const held = jar.get(REGISTRATION_PROOF_COOKIE)?.value;
    if (checkRegistrationProof(address, held)) return { verified: true };

    return { error: "验证码已失效，请重新获取。" };
  }

  if (result.reason === "mismatch") {
    return {
      error:
        result.attemptsLeft > 0
          ? `验证码不正确，还可以再试 ${result.attemptsLeft} 次。`
          : "验证码不正确，错误次数已用完，请重新获取。",
    };
  }

  return { error: VERIFY_FAILURES[result.reason] };
}

export interface RegisterState {
  error?: string;
  /**
   * The account exists but the session does not. Only reachable if signing in
   * on the new account's behalf is refused — see the note in `registerAction`.
   */
  createdNeedsLogin?: boolean;
}

const schema = z
  .object({
    handle: handleSchema,
    displayName: z.string().trim().min(1, "请填写显示名").max(64, "显示名过长"),
    email: emailSchema,
    password: z.string().min(8, "密码至少 8 位"),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

/**
 * One sentence for both ways a handle can be unavailable, and the same
 * constant rather than two copies of it, so they cannot drift back apart.
 *
 * Taken and reserved are different facts with very different audiences. A
 * taken handle is public — it is on every standings page. A reserved one is
 * either on `enrollmentPolicy.reservedHandles` or named by a `handles` rule in
 * `content/enrollment/`, and that second list is the interesting one: a rule
 * naming somebody is a membership waiting to be claimed, so it is a list of
 * the accounts worth grabbing before their owner arrives. Two different
 * sentences turn this form into a way to read that list one guess at a time.
 */
const HANDLE_UNAVAILABLE = "这个用户名不可用，换一个试试。";

/**
 * Unlike the login and recovery forms, this one says exactly what went wrong.
 *
 * Being vague there is worth it because it stops the form being used to test
 * whether somebody has an account. A registration form cannot make the same
 * trade: telling a person their username will not work is the only thing that
 * lets them pick another one. What it does not have to say is *why*.
 */
const REJECTIONS: Record<RegisterRejection, string> = {
  disabled: "当前未开放注册。",
  "handle-taken": HANDLE_UNAVAILABLE,
  "handle-reserved": HANDLE_UNAVAILABLE,
  "email-domain": "这个邮箱域名不在允许注册的范围内。",
  "email-taken": "这个邮箱已经注册过了。如果是你本人，请用「找回密码」。",
  "email-unverified": "邮箱尚未验证，或验证已超时。请重新获取验证码。",
};

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  if (!enrollmentPolicy.enabled) return { error: REJECTIONS.disabled };

  const parsed = schema.safeParse({
    handle: formData.get("handle"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const limit = await rateLimitByCaller(
    "register",
    enrollmentPolicy.registrationsPerIpPerHour,
    60 * 60 * 1000,
  );
  if (!limit.ok) {
    return { error: "注册过于频繁，请稍后再试。" };
  }

  const jar = await cookies();
  const proof = jar.get(REGISTRATION_PROOF_COOKIE)?.value;
  const result = await register({ ...parsed.data, proof });
  if (!result.ok) return { error: REJECTIONS[result.reason] };

  // Spent. Leaving it around would let a later submit on this browser
  // skip proving a different address that happened to be verified.
  jar.delete(REGISTRATION_PROOF_COOKIE);

  // Straight into the session rather than onto a page announcing success. The
  // person just typed the password; asking for it again to prove something
  // that was true a moment ago is a step that exists only because the account
  // used to be unusable at this point. It no longer is.
  try {
    await signIn("credentials", {
      handle: result.handle,
      password: parsed.data.password,
      redirectTo: "/",
    });
  } catch (error) {
    // `signIn` reports success by throwing NEXT_REDIRECT; let that through.
    if (!(error instanceof AuthError)) throw error;

    // The account is real and the password is right, so the only way here is
    // the login throttle in `authorize` — a shared address that has already
    // spent its attempts. Say what happened rather than reporting a failed
    // registration for something that succeeded.
    console.error("[foi] 注册后自动登录失败", error);
    return { createdNeedsLogin: true };
  }

  // As on the login form, `signIn` leaves by throwing, so there is no path
  // through here. The `return {}` that used to sit here would have shown a
  // blank form to somebody whose account had just been created, sending them
  // to retry and collide with their own handle.
  throw new Error("signIn 没有重定向，注册后的登录结果未知");
}
