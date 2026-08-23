import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { verifyPassword } from "@/lib/auth/credentials";
import { getMember } from "@/lib/roster/registry";
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
       * Two independent checks, against two different sources of truth: the
       * roster says whether this person exists and may log in, the database
       * says whether they got the password right. Neither can stand in for
       * the other, which is the whole point of the split — removing someone
       * from the roster locks them out even though their hash is still on
       * disk.
       */
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { handle, password } = parsed.data;
        const member = getMember(handle);

        // Still verify against a decoy so an unlisted handle costs the same
        // wall time as a listed one with the wrong password.
        if (!member || member.disabled) {
          await verifyPassword(handle, password);
          return null;
        }

        if (!(await verifyPassword(member.handle, password))) return null;

        // Only the handle travels onwards; the session callback re-reads the
        // rest from the roster on every request.
        return { id: member.handle, handle: member.handle };
      },
    }),
  ],
});

/** Current user for server components and route handlers. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.handle) return null;
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
