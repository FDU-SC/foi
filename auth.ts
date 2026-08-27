import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { resolveUser, resolveUserByUsername } from "@/lib/accounts/resolve";
import { normalizeUsername } from "@/lib/accounts/types";
import type { ResolvedUser } from "@/lib/accounts/types";
import {
  passwordSetAt,
  sessionMatchesPassword,
  verifyPassword,
} from "@/lib/accounts/password";
import { findAccountByEmail } from "@/lib/accounts/queries";
import type { Capability } from "@/lib/permissions/policy";
import { viewerFor, type SessionUser, type Viewer } from "@/lib/permissions/viewer";
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
    groups: user.groups,
  };
}

export async function getViewer(): Promise<Viewer> {
  return viewerFor(await getSessionUser());
}

export class ForbiddenError extends Error {
  constructor(readonly capability: Capability) {
    super("没有执行这个操作的权限");
    this.name = "ForbiddenError";
  }
}

export async function requireCapability(
  capability: Capability,
): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.can(capability)) throw new ForbiddenError(capability);
  return viewer;
}
