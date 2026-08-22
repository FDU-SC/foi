"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { z } from "zod";
import { getSessionUser, hashPassword } from "@/auth";
import { db } from "@/lib/db";
import {
  contestProblems,
  contests,
  problems,
  users,
} from "@/lib/db/schema";
import { syncProblems } from "@/lib/problems/sync";
import { invalidateStandings } from "@/lib/standings/cache";
import { getRuleset } from "@/lib/standings/registry";

export interface ActionState {
  error?: string;
  message?: string;
}

/**
 * Server Actions are reachable by POST regardless of what the proxy matched,
 * so every one of them re-checks the role rather than trusting the route.
 */
async function requireAdmin(): Promise<void> {
  const user = await getSessionUser();
  if (user?.role !== "admin") throw new Error("FORBIDDEN");
}

export async function syncProblemsAction(): Promise<ActionState> {
  await requireAdmin();
  const { synced } = await syncProblems();
  revalidatePath("/admin");
  revalidatePath("/problems");
  return { message: `已同步 ${synced} 道题目` };
}

/** Same as above, shaped for `useActionState`. */
export async function syncProblemsFormAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return syncProblemsAction();
}

const createUserSchema = z.object({
  handle: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, "用户名只能包含字母、数字、下划线和连字符"),
  displayName: z.string().min(1).max(64),
  password: z.string().min(8, "密码至少 8 位"),
  role: z.enum(["user", "admin"]),
});

export async function createUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const parsed = createUserSchema.safeParse({
    handle: formData.get("handle"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.handle, parsed.data.handle))
    .limit(1);
  if (existing.length > 0) return { error: "该用户名已存在" };

  await db.insert(users).values({
    id: ulid(),
    handle: parsed.data.handle,
    displayName: parsed.data.displayName,
    passwordHash: await hashPassword(parsed.data.password),
    role: parsed.data.role,
  });

  revalidatePath("/admin/users");
  return { message: `已创建账号 ${parsed.data.handle}` };
}

export async function toggleUserAction(userId: string): Promise<void> {
  await requireAdmin();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return;

  await db
    .update(users)
    .set({ disabled: !user.disabled })
    .where(eq(users.id, userId));
  revalidatePath("/admin/users");
}

const createContestSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, "标识只能包含小写字母、数字和连字符"),
  title: z.string().min(1),
  rulesetId: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});

export async function createContestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const parsed = createContestSchema.safeParse({
    slug: formData.get("slug"),
    title: formData.get("title"),
    rulesetId: formData.get("rulesetId"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }
  if (!getRuleset(parsed.data.rulesetId)) {
    return { error: "未知的赛制" };
  }

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = new Date(parsed.data.endsAt);
  if (!(startsAt < endsAt)) return { error: "结束时间必须晚于开始时间" };

  const existing = await db
    .select({ id: contests.id })
    .from(contests)
    .where(eq(contests.slug, parsed.data.slug))
    .limit(1);
  if (existing.length > 0) return { error: "该比赛标识已存在" };

  await db.insert(contests).values({
    id: ulid(),
    slug: parsed.data.slug,
    title: parsed.data.title,
    rulesetId: parsed.data.rulesetId,
    startsAt,
    endsAt,
  });

  revalidatePath("/admin/contests");
  revalidatePath("/contests");
  return { message: `已创建比赛 ${parsed.data.title}` };
}

export async function addContestProblemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const contestId = String(formData.get("contestId") ?? "");
  const problemSlug = String(formData.get("problemSlug") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!contestId || !problemSlug || !label) {
    return { error: "请填写完整" };
  }

  const known = await db
    .select({ slug: problems.slug })
    .from(problems)
    .where(eq(problems.slug, problemSlug))
    .limit(1);
  if (known.length === 0) {
    return { error: "题目尚未同步，请先在概览页同步题目" };
  }

  const existing = await db
    .select({ order: contestProblems.order })
    .from(contestProblems)
    .where(eq(contestProblems.contestId, contestId));

  await db
    .insert(contestProblems)
    .values({
      contestId,
      problemSlug,
      label,
      order: existing.length,
    })
    .onConflictDoUpdate({
      target: [contestProblems.contestId, contestProblems.problemSlug],
      set: { label },
    });

  invalidateStandings(contestId);
  revalidatePath("/admin/contests");
  return { message: `已添加 ${label}. ${problemSlug}` };
}
