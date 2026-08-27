import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { resolveUser } from "@/lib/accounts/resolve";
import { normalizeHandle } from "@/lib/accounts/types";
import type { ResolvedUser } from "@/lib/accounts/types";
import {
  passwordSetAt,
  sessionMatchesPassword,
  verifyPassword,
} from "@/lib/accounts/password";
import type { Capability } from "@/lib/permissions/policy";
import { viewerFor, type SessionUser, type Viewer } from "@/lib/permissions/viewer";
import { rateLimit, rateLimitBySource, sourceFrom } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

const credentialsSchema = z.object({
  handle: z.string().min(1),
  password: z.string().min(1),
});

const PER_HANDLE = ACTION_LIMITS.login;
const PER_SOURCE = ACTION_LIMITS.login.also;

function withinLoginRate(handle: string, request: Request | undefined): boolean {
  if (
    !rateLimit(
      `login:handle:${normalizeHandle(handle)}`,
      PER_HANDLE.max,
      PER_HANDLE.windowSeconds * 1000,
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
        handle: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },

      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { handle, password } = parsed.data;

        if (!withinLoginRate(handle, request)) return null;

        const user = await resolveUser(handle);

        if (!user || user.disabled) {
          await verifyPassword(handle, password);
          return null;
        }

        const check = await verifyPassword(user.handle, password);
        if (!check.ok) return null;

        return {
          id: user.handle,
          handle: user.handle,
          passwordAt: check.setAt.getTime(),
        };
      },
    }),
  ],
});

export async function getResolvedUser(): Promise<ResolvedUser | null> {
  const session = await auth();
  const handle = session?.user?.handle;
  if (!handle) return null;

  const user = await resolveUser(handle);
  if (!user || user.disabled) return null;

  const setAt = await passwordSetAt(handle);
  if (!sessionMatchesPassword(setAt, session.user.passwordAt)) return null;

  return user;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await getResolvedUser();
  if (!user) return null;
  return {
    handle: user.handle,
    displayName: user.displayName,
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
