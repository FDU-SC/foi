"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getViewer } from "@/auth";
import { authorize } from "@/lib/authz/engine";
import {
  caseArgv,
  checkDraft,
  createDraft,
  deleteDraft,
  draftFor,
  draftSchema,
  publishDraft,
  saveDraft,
  unpublishDraft,
  type DraftIssues,
  type SlugConflict,
} from "@/lib/problems/authoring";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import { SLUG_PATTERN } from "@/lib/utils";
import { parseInput } from "@/lib/validation";

/**
 * Writing problems from the console.
 *
 * Every entry point asks `problem.author` for itself: the page that renders the
 * form is not an enforcement point, and a form post does not have to have come
 * from it.
 */

export interface AuthorState {
  error?: string;
  message?: string;
  issues?: DraftIssues;
}

const AUTHOR = "problem.author";

function denied(): AuthorState {
  return { error: "页面不存在" };
}

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "请填写标识")
    .max(64)
    .regex(SLUG_PATTERN, "标识只能包含小写字母、数字和连字符"),
  title: z.string().trim().min(1, "请填写标题").max(120),
});

const slugSchema = z.object({ slug: z.string().trim().min(1).max(64) });

/**
 * Why a slug is not available, in the operator's terms.
 *
 * The three cases are different situations and deserve different sentences: one
 * is a repository problem to rename around, one is another authored problem, and
 * one is a slug spent by history that the console cannot clear.
 */
function slugTaken(slug: string, conflict: SlugConflict): string {
  switch (conflict) {
    case "filesystem":
      return `仓库里已经有题目「${slug}」，请换一个标识。`;
    case "authored":
      return `标识「${slug}」已经被占用了，请换一个。`;
    case "history":
      return `标识「${slug}」还留着已下架题目的提交记录，不能复用；请换一个标识。`;
  }
}

/** The form's fields as one object, case rows and contest choices included. */
function draftFromForm(formData: FormData): unknown {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };

  /** Blank means "ask the judge for its default", so the field is left out. */
  const optionalNumber = (name: string): string | undefined => {
    const value = text(name).trim();
    return value.length === 0 ? undefined : value;
  };

  const cases: unknown[] = [];
  for (let index = 0; formData.has(`cases.${index}.name`); index += 1) {
    const threads = text(`cases.${index}.threads`).trim();
    cases.push({
      name: text(`cases.${index}.name`),
      argv: caseArgv(text(`cases.${index}.argv`)),
      ...(threads.length === 0 ? {} : { threads }),
      timeLimitMs: text(`cases.${index}.timeLimitMs`),
      maxScore: text(`cases.${index}.maxScore`),
    });
  }

  // A multi-select sends its values in the order the options are declared, not
  // the order they were picked, so the order a problem sits in a contest is the
  // order of the panel below rather than of this list.
  const contests = formData
    .getAll("contests")
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((slug) => {
      const label = text(`contestLabels.${slug}`).trim();
      return { slug, ...(label.length === 0 ? {} : { label }) };
    });

  let ui: unknown = {};
  try {
    ui = JSON.parse(text("ui") || "{}");
  } catch {
    ui = null;
  }

  const shell = text("shell").trim();
  const addressSpace = text("addressSpace");
  const stackLimitMb = optionalNumber("stackLimitMb");
  const seed = optionalNumber("seed");

  return {
    slug: text("slug"),
    title: text("title"),
    maxScore: text("maxScore"),
    statementMdx: text("statementMdx"),
    ui,
    viewsPreset: text("viewsPreset"),
    script: text("script"),
    contestant: text("contestant"),
    ...(shell.length === 0 ? {} : { shell }),
    memoryLimitMb: text("memoryLimitMb"),
    maxFileMb: text("maxFileMb"),
    ...(stackLimitMb === undefined ? {} : { stackLimitMb }),
    ...(addressSpace.length === 0 ? {} : { addressSpace }),
    ...(seed === undefined ? {} : { seed }),
    // A checkbox that is unticked sends nothing at all, so presence is the value.
    resultRequired: formData.get("resultRequired") !== null,
    cases,
    contests,
  };
}

export async function createProblemAction(
  _prev: AuthorState,
  formData: FormData,
): Promise<AuthorState> {
  const viewer = await getViewer();
  if (!authorize(AUTHOR, null, viewer).allow) return denied();

  const limited = await rateLimit(`author:create:${viewer.uid}`, ACTION_LIMITS.createProblemAction);
  if (!limited.ok) return { error: "新建过于频繁，请稍后再试。" };

  const parsed = parseInput(createSchema, {
    slug: formData.get("slug"),
    title: formData.get("title"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const created = await createDraft(parsed.data.slug, parsed.data.title, viewer.uid);
  if (created.kind === "taken") {
    return { error: slugTaken(parsed.data.slug, created.conflict) };
  }

  revalidatePath("/admin/problems");

  // Straight into the editor: a draft with no judge files and no statement is
  // not something to look at on a list.
  redirect(`/admin/problems/${parsed.data.slug}`);
}

/**
 * Save a draft.
 *
 * A draft that does not check out is saved anyway, with what is wrong reported
 * beside it: an author fixing three things at once should not have to make the
 * form valid before any of it sticks. Publishing runs the same check and blocks.
 */
export async function saveProblemAction(
  _prev: AuthorState,
  formData: FormData,
): Promise<AuthorState> {
  const viewer = await getViewer();
  if (!authorize(AUTHOR, null, viewer).allow) return denied();

  const limited = await rateLimit(`author:save:${viewer.uid}`, ACTION_LIMITS.saveProblemAction);
  if (!limited.ok) return { error: "保存过于频繁，请稍后再试。" };

  const parsed = draftSchema.safeParse(draftFromForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "表单内容不合法" };
  }

  if (!(await saveDraft(parsed.data, [], { replaceFiles: false }))) {
    return { error: "草稿不存在。" };
  }

  const view = await draftFor(parsed.data.slug);
  if (!view) return { error: "草稿不存在。" };

  revalidatePath("/admin/problems");
  revalidatePath(`/admin/problems/${parsed.data.slug}`);

  return {
    message: "已保存。",
    issues: checkDraft(view.draft, view.files, { selfSlug: parsed.data.slug }),
  };
}

export async function publishProblemAction(
  _prev: AuthorState,
  formData: FormData,
): Promise<AuthorState> {
  const viewer = await getViewer();
  if (!authorize(AUTHOR, null, viewer).allow) return denied();

  const limited = await rateLimit(`author:publish:${viewer.uid}`, ACTION_LIMITS.publishProblemAction);
  if (!limited.ok) return { error: "操作过于频繁，请稍后再试。" };

  const parsed = parseInput(slugSchema, { slug: formData.get("slug") });
  if (!parsed.ok) return { error: parsed.error };

  const issues = await publishDraft(parsed.data.slug);
  if (!issues) return { error: "草稿不存在。" };
  if (issues.errors.length > 0) return { error: issues.errors[0], issues };

  revalidatePath("/admin/problems");
  revalidatePath(`/admin/problems/${parsed.data.slug}`);
  revalidatePath("/problems");
  revalidatePath("/contests");

  return { message: "已发布，现在可以在它所属的比赛里打开。", issues };
}

export async function unpublishProblemAction(
  _prev: AuthorState,
  formData: FormData,
): Promise<AuthorState> {
  const viewer = await getViewer();
  if (!authorize(AUTHOR, null, viewer).allow) return denied();

  const limited = await rateLimit(
    `author:unpublish:${viewer.uid}`,
    ACTION_LIMITS.unpublishProblemAction,
  );
  if (!limited.ok) return { error: "操作过于频繁，请稍后再试。" };

  const parsed = parseInput(slugSchema, { slug: formData.get("slug") });
  if (!parsed.ok) return { error: parsed.error };

  await unpublishDraft(parsed.data.slug);
  revalidatePath("/admin/problems");
  revalidatePath(`/admin/problems/${parsed.data.slug}`);
  revalidatePath("/problems");
  revalidatePath("/contests");

  return { message: "已下架，选手现在看不到这道题。" };
}

export async function deleteProblemAction(
  _prev: AuthorState,
  formData: FormData,
): Promise<AuthorState> {
  const viewer = await getViewer();
  if (!authorize(AUTHOR, null, viewer).allow) return denied();

  const limited = await rateLimit(`author:delete:${viewer.uid}`, ACTION_LIMITS.deleteProblemAction);
  if (!limited.ok) return { error: "操作过于频繁，请稍后再试。" };

  const parsed = parseInput(slugSchema, { slug: formData.get("slug") });
  if (!parsed.ok) return { error: parsed.error };

  const result = await deleteDraft(parsed.data.slug);

  // Nothing to report on the way out: the page it redirects to is the list, and
  // the count of what went with it was on the button that was pressed.
  if (result.kind === "missing") return { error: "这道题不存在。" };

  revalidatePath("/admin/problems");
  revalidatePath("/problems");
  revalidatePath("/contests");

  redirect("/admin/problems");
}
