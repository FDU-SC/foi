import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";

const credentialsSchema = z.object({
  handle: z.string().min(1),
  password: z.string().min(1),
});

// Argon2id with parameters in line with the OWASP baseline.
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A real hash, verified against when the account does not exist, so a missing
 * handle costs the same wall time as a wrong password.
 */
const decoyHash = hash("decoy-for-constant-time-login", ARGON2_OPTIONS);

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        handle: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { handle, password } = parsed.data;
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.handle, handle))
          .limit(1);

        if (!user) {
          await verify(await decoyHash, password).catch(() => false);
          return null;
        }
        if (user.disabled) return null;

        const ok = await verify(user.passwordHash, password).catch(() => false);
        if (!ok) return null;

        return {
          id: user.id,
          handle: user.handle,
          displayName: user.displayName,
          role: user.role,
        };
      },
    }),
  ],
});

/** Current user for server components and route handlers. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    handle: session.user.handle,
    displayName: session.user.displayName,
    role: session.user.role,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
