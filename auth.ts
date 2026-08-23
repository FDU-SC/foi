import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { resolveUser } from "@/lib/accounts/resolve";
import type { ResolvedUser } from "@/lib/accounts/types";
import { verifyPassword } from "@/lib/auth/credentials";
import type { SessionUser } from "@/lib/auth/session";

const credentialsSchema = z.object({
  handle: z.string().min(1),
  password: z.string().min(1),
});

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
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { handle, password } = parsed.data;
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
    role: user.role,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
