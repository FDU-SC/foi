import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { resolveUser } from "@/lib/accounts/resolve";
import { normalizeHandle } from "@/lib/accounts/types";
import type { ResolvedUser } from "@/lib/accounts/types";
import { verifyPassword } from "@/lib/auth/credentials";
import type { Capability } from "@/lib/auth/policy";
import type { SessionUser } from "@/lib/auth/session";
import { viewerFor, type Viewer } from "@/lib/auth/viewer";
import { rateLimit } from "@/lib/ratelimit";

const credentialsSchema = z.object({
  handle: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Two keys, because the two abuses look different.
 *
 * Per handle catches somebody grinding one account's password; per source
 * catches somebody spraying one password across many accounts, which the
 * per-handle counter never sees. Neither bound alone is enough.
 *
 * This matters more than the usual case for rate-limiting a login: every
 * attempt costs an argon2 verify at 19 MiB, and `authorize` deliberately runs
 * one even for handles that do not exist so the timing gives nothing away. An
 * unmetered login is therefore a memory and CPU amplifier, not just a
 * guessing oracle.
 */
const PER_HANDLE = { limit: 10, windowMs: 5 * 60 * 1000 };
const PER_SOURCE = { limit: 40, windowMs: 5 * 60 * 1000 };

function withinLoginRate(handle: string, request: Request | undefined): boolean {
  if (
    !rateLimit(
      `login:handle:${normalizeHandle(handle)}`,
      PER_HANDLE.limit,
      PER_HANDLE.windowMs,
    ).ok
  ) {
    return false;
  }

  // Taken off the request rather than `next/headers`, so this works wherever
  // Auth.js invokes the provider. Spoofable by anything that reaches the app
  // directly, which is why it raises cost rather than being a boundary.
  const forwarded = request?.headers.get("x-forwarded-for");
  const source =
    forwarded?.split(",")[0]?.trim() ||
    request?.headers.get("x-real-ip") ||
    "unknown";

  return rateLimit(`login:ip:${source}`, PER_SOURCE.limit, PER_SOURCE.windowMs)
    .ok;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        handle: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },

      /**
       * Two independent checks against two different tables: the account says
       * whether this person exists and is in a state to log in, the
       * credentials row says whether they got the password right. Neither can
       * stand in for the other — suspending someone locks them out even
       * though their hash is untouched.
       */
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { handle, password } = parsed.data;

        // Throttled here rather than in the login server action, because this
        // is the only point every attempt passes through. The action guards
        // the form; posting straight to /api/auth/callback/credentials skips
        // it entirely, which is exactly what anyone grinding passwords would
        // do. Returning null on refusal keeps the response indistinguishable
        // from a wrong password.
        if (!withinLoginRate(handle, request)) return null;

        const user = await resolveUser(handle);

        // Still verify against a decoy so an unknown handle costs the same
        // wall time as a known one with the wrong password.
        if (!user || user.disabled) {
          await verifyPassword(handle, password);
          return null;
        }

        if (!(await verifyPassword(user.handle, password))) return null;

        // Only the handle travels onwards; everything else is re-resolved on
        // each request so a suspension or a demotion lands immediately.
        return { id: user.handle, handle: user.handle };
      },
    }),
  ],
});

/**
 * The authoritative answer to "who is making this request", and the place
 * every protected page, route handler and server action starts from.
 *
 * The session callback in `auth.config.ts` produces an optimistic view for the
 * proxy out of the token and the repository alone. This is the one that reads
 * the account row, so it is the one that notices a suspension. Anything
 * guarding data must call this rather than trusting the session object.
 */
export async function getResolvedUser(): Promise<ResolvedUser | null> {
  const session = await auth();
  const handle = session?.user?.handle;
  if (!handle) return null;

  const user = await resolveUser(handle);
  return user && !user.disabled ? user : null;
}

/** The narrowed shape most callers want. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await getResolvedUser();
  if (!user) return null;
  return {
    handle: user.handle,
    displayName: user.displayName,
    groups: user.groups,
  };
}

/**
 * Who is asking, in the form the access layers take.
 *
 * The usual first line of a page or route handler. Resolved from the account
 * row rather than the token, so a suspension or a demotion is already
 * reflected in what this viewer may do.
 */
export async function getViewer(): Promise<Viewer> {
  return viewerFor(await getSessionUser());
}

/**
 * The viewer, or a refusal.
 *
 * Server Actions are reachable by POST regardless of what the proxy matched,
 * so every one of them starts here rather than trusting the route. Returning
 * the viewer as well means the action can pass it straight to an access layer
 * instead of asking a second time in a second way.
 */
export async function requireCapability(
  capability: Capability,
): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.can(capability)) throw new Error("FORBIDDEN");
  return viewer;
}
