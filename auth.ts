import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { resolveUser, resolveUserByUsername } from "@/lib/accounts/resolve";
import type { ResolvedUser } from "@/lib/accounts/types";
import {
  passwordSetAt,
  sessionMatchesPassword,
  verifyPassword,
} from "@/lib/accounts/password";
import { findAccountByEmail } from "@/lib/accounts/queries";
import type { AccountActionId } from "@/lib/authz/actions";
import { assertAllowed } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import { viewerFor, type SessionUser, type Viewer } from "@/lib/authz/viewer";
import { rateLimit, rateLimitBySource, sourceFrom } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

const credentialsSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const PER_UID = ACTION_LIMITS.login;
const PER_SOURCE = ACTION_LIMITS.login.also;

function withinLoginRate(uid: number, request: Request | undefined): boolean {
  if (
    !rateLimit(
      `login:uid:${uid}`,
      PER_UID.max,
      PER_UID.windowSeconds * 1000,
    ).ok
  ) {
    return false;
  }

  const source = request ? sourceFrom(request.headers) : "unknown";

  return rateLimitBySource(
    "login:ip",
    source,
    PER_SOURCE.max,
    PER_SOURCE.windowSeconds * 1000,
  ).ok;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        identifier: { label: "用户名或邮箱", type: "text" },
        password: { label: "密码", type: "password" },
      },

      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { identifier, password } = parsed.data;

        const account = identifier.includes("@")
          ? await findAccountByEmail(identifier.trim().toLowerCase())
          : await (async () => {
              const resolved = await resolveUserByUsername(identifier);
              return resolved
                ? { uid: resolved.uid, status: resolved.status }
                : undefined;
            })();

        if (!account) {
          const source = request ? sourceFrom(request.headers) : "unknown";
          rateLimitBySource(
            "login:ip",
            source,
            PER_SOURCE.max,
            PER_SOURCE.windowSeconds * 1000,
          );
          return null;
        }

        if (!withinLoginRate(account.uid, request)) return null;

        if (account.status !== "active") {
          await verifyPassword(account.uid, password);
          return null;
        }

        const check = await verifyPassword(account.uid, password);
        if (!check.ok) return null;

        return {
          id: String(account.uid),
          uid: account.uid,
          passwordAt: check.setAt.getTime(),
        };
      },
    }),
  ],
});

export async function getResolvedUser(): Promise<ResolvedUser | null> {
  const session = await auth();
  const uid = session?.user?.uid;
  if (!uid) return null;

  const user = await resolveUser(uid);
  if (!user || user.disabled) return null;

  const setAt = await passwordSetAt(uid);
  if (!sessionMatchesPassword(setAt, session.user.passwordAt)) return null;

  return user;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await getResolvedUser();
  if (!user) return null;
  return {
    uid: user.uid,
    username: user.username,
    nickname: user.nickname,
    avatarUpdatedAt: user.avatarUpdatedAt,
    groups: user.groups,
  };
}

export async function getViewer(): Promise<Viewer> {
  return viewerFor(await getSessionUser());
}

/**
 * The signed-in account, together with the right to take this action on it.
 *
 * Self-service is authorization like anything else: a deployment can forbid
 * changing an email during a contest, and the answer arrives here rather than
 * as a condition scattered through the form handlers.
 */
export async function requireSelf(
  action: AccountActionId,
): Promise<ResolvedUser> {
  const user = await getResolvedUser();
  if (!user) redirect("/login");

  assertAllowed(authorize(action, user, viewerFor(user)));
  return user;
}
