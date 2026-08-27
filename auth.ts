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
import { ACTION_LIMITS, alsoRule, fixedRule } from "@/lib/ratelimit/policy";

const credentialsSchema = z.object({
  handle: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Two keys, because the two abuses look different and neither counter sees
 * the other's.
 *
 * Both numbers are read out of `ACTION_LIMITS.login` rather than written
 * here, which is what makes that table the answer to "what bounds a login"
 * instead of a second place to keep in step. Why there are two of them, and
 * why they are set where they are, is argued on the entry.
 */
const PER_HANDLE = fixedRule(ACTION_LIMITS.login);
const PER_SOURCE = alsoRule(ACTION_LIMITS.login);

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

  // Taken off the request rather than `next/headers`, so this works wherever
  // Auth.js invokes the provider. Read through `sourceFrom` rather than off
  // `x-forwarded-for` directly: the leftmost entry is the one the sender
  // writes, so reading it counts attempts per header value instead of per
  // machine and a sprayer simply varies it.
  const source = request ? sourceFrom(request.headers) : "unknown";

  // Only the second half stands aside when no source can be established, and
  // the asymmetry is the point. The per-handle counter above is keyed on
  // something the caller cannot vary, so it is unaffected by what sits in
  // front and goes on capping guesses at one account. This one caps a spray
  // across many accounts, which is a shape only a source can see — so with no
  // source it has nothing to say, and saying it against a sentinel would have
  // pooled every login on the deployment into one budget of forty per five
  // minutes. See `rateLimitBySource`.
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

      /**
       * Two independent checks against one row: `status` says whether this
       * person exists and is in a state to log in, the hash says whether they
       * got the password right. Neither can stand in for the other —
       * suspending someone locks them out even though their hash is untouched.
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

        const check = await verifyPassword(user.handle, password);
        if (!check.ok) return null;

        // The handle, plus the password this session is being minted
        // against; everything else is re-resolved on each request
        // so a suspension or a demotion lands immediately. That second claim
        // is what `getResolvedUser` compares to make a password reset end the
        // sessions that came before it.
        return {
          id: user.handle,
          handle: user.handle,
          passwordAt: check.setAt.getTime(),
        };
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
  if (!user || user.disabled) return null;

  /**
   * A session is only good for the password it was issued against.
   *
   * Suspension bites immediately because the check above reads a column.
   * Changing a password would not: the token carries a handle and nothing
   * else, the account row still says `active`, and a stolen cookie would keep
   * working for the rest of its week — through the one remedy the person whose
   * account it is can actually reach. Resetting a password is what someone
   * does *because* they think a session was taken, so it has to be the thing
   * that ends it.
   *
   * A token carrying no such claim decodes to 0 and fails too, which is the
   * right way round.
   */
  const setAt = await passwordSetAt(handle);
  if (!sessionMatchesPassword(setAt, session.user.passwordAt)) return null;

  return user;
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
 * What `requireCapability` throws, and the reason it is a class rather than a
 * bare `Error` with `"FORBIDDEN"` in it.
 *
 * A refusal is an ordinary outcome — a stale page offering a button whose
 * privilege has since been revoked reaches this on every press — and an
 * ordinary outcome has to be distinguishable from a bug by something better
 * than a string comparison. The three console actions catch this and answer
 * their form; anything else that fails, and anything that throws this
 * somewhere nobody catches, goes on to `app/error.tsx`.
 *
 * The capability is carried rather than interpolated into the message, because
 * the message is written for whoever is looking at the screen and the
 * capability name is an identifier out of `lib/permissions/policy.ts`. Anything
 * wanting to say which one was missing can read the field.
 */
export class ForbiddenError extends Error {
  constructor(readonly capability: Capability) {
    super("没有执行这个操作的权限");
    this.name = "ForbiddenError";
  }
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
  if (!viewer.can(capability)) throw new ForbiddenError(capability);
  return viewer;
}
