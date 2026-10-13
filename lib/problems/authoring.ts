import "server-only";

import { and, asc, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { authoring, listPresets, listUiFields, presetViews } from "@/lib/authoring/registry";
import type { UiField } from "@/lib/authoring/types";
import { backends } from "@/lib/backend/registry";
import { isCatalogue, STANDINGS_SEGMENT } from "@/lib/contests/catalogue";
import { allContests } from "@/lib/contests/registry";
import { hasContestEnded } from "@/lib/contests/types";
import { db } from "@/lib/db";
import {
  problemContests,
  problemFiles,
  problems,
  submissions,
  type ProblemFileRow,
  type ProblemStatus,
} from "@/lib/db/schema";
import { refreshLibrary } from "@/lib/problems/library";
import { filesystemProblem } from "@/lib/problems/registry";
import {
  decodeJudgeFile,
  judgeFileProblem,
  type JudgeFile,
} from "@/lib/problems/judge-file";
import { statementNeedsNoModuleSyntax } from "@/lib/problems/statement";
import { draftSchema, type DraftInput, type DraftIssues } from "@/lib/problems/draft";

export {
  caseArgv,
  caseSchema,
  contestLinkSchema,
  draftSchema,
  type DraftInput,
  type DraftIssues,
} from "@/lib/problems/draft";

/**
 * Authoring a problem from the console.
 *
 * A problem written here is a row rather than a directory. Three steps produce
 * one — upload its judge files, fill in its parameters, write its statement —
 * and the state between them is a draft: visible to the console, reachable by
 * nobody, and not in any registry until it is published.
 *
 * Nothing here decides whether the author may act. Every entry point is behind
 * `problem.author`, asked by the page and the action that calls in.
 */

/** The backend authored problems are judged by, which the deployment names. */
export const AUTHORED_BACKEND_ID = authoring.authoredBackend;

export interface ProblemFileView {
  path: string;
  encoding: "base64" | null;
  size: number;
}

export interface DraftView {
  slug: string;
  title: string;
  status: ProblemStatus;
  statementMdx: string;
  ui: Record<string, unknown>;
  viewsPreset: string;
  config: Record<string, unknown>;
  draft: DraftInput;
  files: ProblemFileView[];
  contests: { slug: string; label: string | null; position: number }[];
  createdBy: number | null;
  updatedAt: Date | null;
}

/* ------------------------------------------------------------------ checking */

function checkUi(
  ui: Record<string, unknown>,
  fields: readonly UiField[],
): string[] {
  const issues: string[] = [];
  const known = new Map(fields.map((field) => [field.key, field]));

  for (const key of Object.keys(ui)) {
    if (!known.has(key)) issues.push(`展示字段 "${key}" 不是这套部署提供的字段。`);
  }

  for (const field of fields) {
    const value = ui[field.key];
    if (value === undefined) continue;

    switch (field.kind) {
      case "text":
        if (typeof value !== "string") issues.push(`"${field.label}" 需要一段文本。`);
        break;
      case "tags":
        if (!Array.isArray(value) || value.some((one) => typeof one !== "string")) {
          issues.push(`"${field.label}" 需要一组标签。`);
        }
        break;
      case "choice": {
        const allowed = new Set(field.options.map((option) => option.value));
        if (typeof value !== "string" || !allowed.has(value)) {
          issues.push(`"${field.label}" 只能取 ${[...allowed].join("、")}。`);
        }
        break;
      }
      case "multi": {
        const allowed = new Set(field.options.map((option) => option.value));
        if (!Array.isArray(value) || value.some((one) => typeof one !== "string" || !allowed.has(one))) {
          issues.push(`"${field.label}" 只能取 ${[...allowed].join("、")}。`);
        }
        break;
      }
    }
  }

  return issues;
}

function checkFiles(input: DraftInput, files: readonly ProblemFileView[]): string[] {
  const issues: string[] = [];

  if (files.length === 0) {
    issues.push("还没有上传判题文件。");
    return issues;
  }

  const byPath = new Map(files.map((file) => [file.path, file]));

  if (input.script.length === 0) {
    issues.push("还没有指定判题脚本。");
  } else if (!byPath.has(input.script)) {
    issues.push(`判题脚本 "${input.script}" 不在已上传的文件里。`);
  }

  // The judge runs `shell script`, and the shell is resolved from its own PATH —
  // so naming an uploaded file there is a program it can never find. It is the
  // mistake the two adjacent fields invite, and the judge reports it as a
  // missing interpreter rather than as a wrong setting.
  if (input.shell !== undefined && byPath.has(input.shell)) {
    issues.push(
      `"${input.shell}" 是已上传的判题文件，不是解释器；判题机在自己的 PATH 上找它，所以找不到。shell 留空即用 sh。`,
    );
  }

  if (input.contestant.length === 0) {
    issues.push("还没有指定选手提交要覆盖的文件。");
  } else {
    const contestant = byPath.get(input.contestant);

    if (!contestant) {
      issues.push(`选手提交要覆盖的 "${input.contestant}" 不在已上传的文件里。`);
    } else if (contestant.encoding === "base64") {
      // The judge writes the submission over this file, and a submission is a
      // JSON string, so this one is text by construction.
      issues.push(`"${input.contestant}" 是二进制文件，不能作为选手提交的落点。`);
    } else if (contestant.size === 0) {
      issues.push(`"${input.contestant}" 是空的，判题机会拒绝空文件。`);
    }
  }

  return issues;
}

function checkContests(input: DraftInput, publishing: boolean): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.contests.length === 0) {
    const complaint =
      "题目必须属于至少一场比赛：不属于任何比赛的题目没有地址，也没有人能打开。";
    if (publishing) errors.push(complaint);
    else warnings.push(complaint);
    return { errors, warnings };
  }

  const seen = new Set<string>();
  const labels = new Set<string>();

  for (const link of input.contests) {
    if (seen.has(link.slug)) {
      errors.push(`比赛 "${link.slug}" 被选了两次。`);
      continue;
    }
    seen.add(link.slug);

    if (link.label !== undefined) {
      if (labels.has(link.label)) errors.push(`编号 "${link.label}" 重复。`);
      labels.add(link.label);
    }

    const contest = allContests().find((one) => one.slug === link.slug);
    if (!contest) {
      errors.push(`没有比赛 "${link.slug}"。`);
      continue;
    }

    if (hasContestEnded(contest)) {
      warnings.push(`比赛 "${contest.title}" 已经结束，题目公开后也只在赛后可见范围内出现。`);
    }

    // A catalogued section answers `/problems/<section>/standings` with its
    // leaderboard, so a problem by that name has no address at all.
    if (isCatalogue(link.slug) && input.slug === STANDINGS_SEGMENT) {
      errors.push(
        `题库比赛 "${contest.title}" 里不能有标识为 "${STANDINGS_SEGMENT}" 的题目，那个地址是排行榜。`,
      );
    }
  }

  return { errors, warnings };
}

/**
 * Everything wrong with a draft, and everything worth knowing about it.
 *
 * Errors block publishing; warnings do not. Both are shown while editing, so an
 * author sees a missing test point or an ended contest before pressing publish
 * rather than as a refusal afterwards.
 *
 * This is the same check the repository's own problems get from
 * `judge-files.test.ts` and the boot diagnostics, restated for files that live in
 * a table: the byte round trip becomes the encoding claim, the slug/directory
 * rule becomes slug uniqueness against the repository, and "some contest lists
 * it" becomes a required `problem_contests` row.
 */
export function checkDraft(
  input: DraftInput,
  files: readonly ProblemFileView[],
  options: { publishing?: boolean; selfSlug?: string } = {},
): DraftIssues {
  const publishing = options.publishing ?? false;
  const errors: string[] = [];
  const warnings: string[] = [];

  errors.push(...checkUi(input.ui, listUiFields()));
  errors.push(...checkFiles(input, files));

  // The schema requires one, but a row that no longer parses is opened as an
  // empty draft so it can be repaired; that draft has to be told what is wrong.
  if (input.cases.length === 0) errors.push("至少需要一个测试点。");

  const contest = checkContests(input, publishing);
  errors.push(...contest.errors);
  warnings.push(...contest.warnings);

  const collision = filesystemProblem(input.slug);
  if (collision && collision.slug !== options.selfSlug) {
    errors.push(`仓库里已经有题目 "${input.slug}"，请换一个标识。`);
  }

  // The invariant the repository keeps in CI, restated for a problem that
  // appears after the build: a problem routed to a backend nobody declares
  // would sit in the queue forever with nothing to claim it.
  if (!backends[AUTHORED_BACKEND_ID]) {
    errors.push(
      `这套部署没有登记评测后端 "${AUTHORED_BACKEND_ID}"，库中的题目无法被评测。`,
    );
  }

  if (!statementNeedsNoModuleSyntax(input.statementMdx)) {
    errors.push("题面不能包含 import 或 export：可用的组件已经全部提供，不需要引入。");
  }

  if (input.statementMdx.trim().length === 0) {
    warnings.push("题面还是空的。");
  }

  if (!listPresets().some((preset) => preset.id === input.viewsPreset)) {
    warnings.push(
      `展示 preset "${input.viewsPreset}" 不再提供，将按默认 preset「${presetViews(input.viewsPreset).label}」渲染。`,
    );
  }

  const declaredScore = input.cases.reduce((total, one) => total + one.maxScore, 0);
  if (declaredScore > input.maxScore) {
    warnings.push(
      `测试点分值合计 ${declaredScore}，超过题目总分 ${input.maxScore}，多出来的部分不会计入。`,
    );
  }

  // The judge derives the address space as `memoryLimitMb + threads ×
  // stackLimitMb + 16`, per test point, so the two are not independent knobs.
  // Nothing here is an error — a deep recursion legitimately wants a large stack
  // — but an author who raises the stack past the data budget should know that
  // the budget is no longer what the run is actually being held to.
  if (input.stackLimitMb !== undefined) {
    const widest = input.cases.reduce(
      (most, one) => Math.max(most, one.threads ?? 1),
      1,
    );
    const stackTotal = widest * input.stackLimitMb;
    if (stackTotal > input.memoryLimitMb) {
      warnings.push(
        `${widest} 个线程各留 ${input.stackLimitMb} MB 栈（共 ${stackTotal} MB），比 ${input.memoryLimitMb} MB 的数据预算还大：地址空间会被栈主导。`,
      );
    }
  }

  return { errors, warnings };
}

/* -------------------------------------------------------------------- reading */

function toFileView(row: ProblemFileRow): ProblemFileView {
  return { path: row.path, encoding: row.encoding, size: row.size };
}

function configOf(row: typeof problems.$inferSelect): Record<string, unknown> {
  return typeof row.config === "object" && row.config !== null && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>)
    : {};
}

/**
 * Whether this config asks for a result line, in the judge's own terms.
 *
 * The judge treats `result.required !== false` as required, so a row that says
 * nothing about it — or says something unreadable — is one that requires it.
 * Mirroring the rule rather than defaulting to `true` is what keeps a config the
 * judge would read one way from rendering another way here.
 */
function resultRequiredOf(config: Record<string, unknown>): boolean {
  const result = config.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) return true;

  return (result as Record<string, unknown>).required !== false;
}

/**
 * One draft as the form edits it.
 *
 * A row that no longer parses still has to open: an author has to be able to fix
 * whatever the schema stopped accepting, and a form that refuses to load the
 * broken value is a form that cannot repair it.
 */
export async function draftFor(slug: string): Promise<DraftView | null> {
  const [row] = await db.select().from(problems).where(eq(problems.slug, slug)).limit(1);
  if (!row || row.status === null) return null;

  const [fileRows, linkRows] = await Promise.all([
    db.select().from(problemFiles).where(eq(problemFiles.problemSlug, slug)).orderBy(asc(problemFiles.path)),
    db.select().from(problemContests).where(eq(problemContests.problemSlug, slug)).orderBy(asc(problemContests.position)),
  ]);

  const config = configOf(row);

  const parsed = draftSchema.safeParse({
    slug: row.slug,
    title: row.title,
    maxScore: row.maxScore ?? 100,
    statementMdx: row.statementMdx ?? "",
    ui: row.ui ?? {},
    viewsPreset: row.viewsPreset ?? presetViews(null).id,
    script: config.script,
    contestant: config.contestant,
    shell: config.shell,
    memoryLimitMb: config.memoryLimitMb,
    maxFileMb: config.maxFileMb,
    stackLimitMb: config.stackLimitMb,
    addressSpace: config.addressSpace,
    seed: config.seed,
    // The judge reads `required !== false`, so anything else in the row is true.
    resultRequired: resultRequiredOf(config),
    cases: config.cases,
    contests: linkRows.map((link) => ({
      slug: link.contestSlug,
      label: link.label ?? undefined,
    })),
  });

  const files = fileRows.map(toFileView);

  if (!parsed.success) {
    return {
      slug: row.slug,
      title: row.title,
      status: row.status,
      statementMdx: row.statementMdx ?? "",
      ui: (row.ui as Record<string, unknown>) ?? {},
      viewsPreset: row.viewsPreset ?? presetViews(null).id,
      config,
      draft: emptyDraft(row, linkRows),
      files,
      contests: linkRows.map((link) => ({
        slug: link.contestSlug,
        label: link.label,
        position: link.position,
      })),
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
    };
  }

  return {
    slug: row.slug,
    title: row.title,
    status: row.status,
    statementMdx: row.statementMdx ?? "",
    ui: (row.ui as Record<string, unknown>) ?? {},
    viewsPreset: row.viewsPreset ?? presetViews(null).id,
    config,
    draft: parsed.data,
    files,
    contests: linkRows.map((link) => ({
      slug: link.contestSlug,
      label: link.label,
      position: link.position,
    })),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  };
}

function emptyDraft(
  row: typeof problems.$inferSelect,
  linkRows: readonly (typeof problemContests.$inferSelect)[],
): DraftInput {
  return {
    slug: row.slug,
    title: row.title,
    maxScore: row.maxScore ?? 100,
    statementMdx: row.statementMdx ?? "",
    ui: (row.ui as Record<string, unknown>) ?? {},
    viewsPreset: row.viewsPreset ?? presetViews(null).id,
    script: "",
    contestant: "",
    shell: undefined,
    memoryLimitMb: 256,
    maxFileMb: 64,
    stackLimitMb: undefined,
    addressSpace: undefined,
    seed: undefined,
    resultRequired: true,
    cases: [],
    contests: linkRows.map((link) => ({
      slug: link.contestSlug,
      label: link.label ?? undefined,
    })),
  };
}

export interface AuthoredProblemRow {
  slug: string;
  title: string;
  status: ProblemStatus;
  viewsPreset: string;
  updatedAt: Date | null;
  files: number;
  contests: string[];
}

/** Every problem authored here, drafts included, for the console's list. */
export async function authoredProblems(): Promise<AuthoredProblemRow[]> {
  const rows = await db
    .select()
    .from(problems)
    .where(sql`${problems.status} is not null`)
    .orderBy(asc(problems.slug));

  if (rows.length === 0) return [];

  const slugs = rows.map((row) => row.slug);
  const [fileRows, linkRows] = await Promise.all([
    db
      .select({ problemSlug: problemFiles.problemSlug })
      .from(problemFiles)
      .where(inArray(problemFiles.problemSlug, slugs)),
    db
      .select({ problemSlug: problemContests.problemSlug, contestSlug: problemContests.contestSlug })
      .from(problemContests)
      .where(inArray(problemContests.problemSlug, slugs)),
  ]);

  const fileCounts = new Map<string, number>();
  for (const row of fileRows) {
    fileCounts.set(row.problemSlug, (fileCounts.get(row.problemSlug) ?? 0) + 1);
  }

  const contestSlugs = new Map<string, string[]>();
  for (const row of linkRows) {
    const list = contestSlugs.get(row.problemSlug);
    if (list) list.push(row.contestSlug);
    else contestSlugs.set(row.problemSlug, [row.contestSlug]);
  }

  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    status: row.status!,
    viewsPreset: row.viewsPreset ?? presetViews(null).id,
    updatedAt: row.updatedAt,
    files: fileCounts.get(row.slug) ?? 0,
    contests: contestSlugs.get(row.slug) ?? [],
  }));
}

/* -------------------------------------------------------------------- writing */

/** The stored bytes of one file, which is what a row's `size` reports. */
function rowsFor(slug: string, files: readonly JudgeFile[], now: Date) {
  return files.map((file) => ({
    problemSlug: slug,
    path: file.path,
    content: file.content,
    encoding: file.encoding ?? null,
    size: decodeJudgeFile(file).length,
    updatedAt: now,
  }));
}

/**
 * Why a slug cannot be authored here.
 *
 * - `filesystem` — the repository ships a problem by that name.
 * - `authored` — another problem here already uses it.
 * - `history` — a row remains from a problem the repository no longer ships, and
 *   submissions point at it. That row cannot be reused: the old history would
 *   silently become the new problem's. It also cannot be removed while those
 *   submissions exist, because `submissions.problem_slug` restricts deletion —
 *   so the slug is spent until an operator deals with the history.
 */
export type SlugConflict = "filesystem" | "authored" | "history";

/**
 * Whether the slug is already spoken for, and by what.
 *
 * Any row counts, not only an authored one. A leftover mirror row is a primary
 * key the same as a draft is, and treating it as free is how a create reaches
 * the database and comes back as a constraint violation instead of a message the
 * form can show.
 */
export async function slugConflict(slug: string): Promise<SlugConflict | null> {
  if (filesystemProblem(slug)) return "filesystem";

  const [row] = await db
    .select({ status: problems.status })
    .from(problems)
    .where(eq(problems.slug, slug))
    .limit(1);

  if (!row) return null;
  return row.status === null ? "history" : "authored";
}

/** Postgres' unique violation. */
const UNIQUE_VIOLATION = "23505";

/** A Postgres error code, whichever layer of the driver wrapped it. */
function hasPgCode(error: unknown, code: string): boolean {
  for (
    let at: unknown = error;
    at !== null && at !== undefined;
    at = (at as { cause?: unknown }).cause
  ) {
    if ((at as { code?: unknown }).code === code) return true;
  }
  return false;
}

export type CreateDraftResult =
  | { kind: "created" }
  | { kind: "taken"; conflict: SlugConflict };

/**
 * Create a draft, or report which slug it collided with.
 *
 * The check lives here rather than only in the form because the primary key is
 * the real rule: two operators naming the same slug at the same moment both pass
 * a pre-check, and only one insert can win. So the insert is attempted anyway,
 * and a duplicate comes back the same way a pre-checked one does — one outcome
 * for the caller to handle rather than two.
 */
export async function createDraft(
  slug: string,
  title: string,
  createdBy: number | null,
): Promise<CreateDraftResult> {
  const taken = await slugConflict(slug);
  if (taken) return { kind: "taken", conflict: taken };

  try {
    await db.insert(problems).values({
      slug,
      title,
      status: "draft",
      statementMdx: "",
      maxScore: 100,
      backendId: AUTHORED_BACKEND_ID,
      // Empty rather than a guess: the form offers the uploaded files as
      // choices, so there is no filename for the platform to assume. The stack
      // limit, the address-space policy and the seed are absent for the same
      // reason — absent is how the judge's own default is asked for.
      config: {
        script: "",
        contestant: "",
        cases: [],
        memoryLimitMb: 256,
        maxFileMb: 64,
        result: { required: true },
      },
      ui: {},
      viewsPreset: presetViews(null).id,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (error) {
    if (hasPgCode(error, UNIQUE_VIOLATION)) return { kind: "taken", conflict: "authored" };
    throw error;
  }

  return { kind: "created" };
}

/** Whether this slug names a draft or a published problem of this deployment's. */
async function authoredExists(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ status: problems.status })
    .from(problems)
    .where(eq(problems.slug, slug))
    .limit(1);

  return row !== undefined && row.status !== null;
}

/**
 * Save a draft, reporting false when there is no such draft.
 *
 * Writing the belonging rows first would make a vanished draft a foreign-key
 * error instead of a message, so the update is the guard: nothing else is
 * touched unless it matched.
 *
 * The overlay is reloaded afterwards, and that is not only for publishing: a
 * published problem's statement and parameters are served from the overlay, so
 * without this a save would leave the live page showing the previous text until
 * something else happened to reload it.
 */
export async function saveDraft(
  input: DraftInput,
  files: readonly JudgeFile[],
  options: { replaceFiles: boolean },
): Promise<boolean> {
  const now = new Date();

  const saved = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(problems)
      .set({
        title: input.title,
        maxScore: input.maxScore,
        statementMdx: input.statementMdx,
        ui: input.ui,
        viewsPreset: input.viewsPreset,
        backendId: AUTHORED_BACKEND_ID,
        config: {
          script: input.script,
          contestant: input.contestant,
          cases: input.cases,
          memoryLimitMb: input.memoryLimitMb,
          maxFileMb: input.maxFileMb,
          result: { required: input.resultRequired },
          ...(input.shell === undefined ? {} : { shell: input.shell }),
          ...(input.stackLimitMb === undefined ? {} : { stackLimitMb: input.stackLimitMb }),
          ...(input.addressSpace === undefined ? {} : { addressSpace: input.addressSpace }),
          ...(input.seed === undefined ? {} : { seed: input.seed }),
        },
        updatedAt: now,
      })
      .where(eq(problems.slug, input.slug))
      .returning({ slug: problems.slug });

    if (!updated) return false;

    if (options.replaceFiles) {
      await tx.delete(problemFiles).where(eq(problemFiles.problemSlug, input.slug));
      if (files.length > 0) {
        await tx.insert(problemFiles).values(rowsFor(input.slug, files, now));
      }
    }

    await tx.delete(problemContests).where(eq(problemContests.problemSlug, input.slug));
    if (input.contests.length > 0) {
      await tx.insert(problemContests).values(
        input.contests.map((link, index) => ({
          problemSlug: input.slug,
          contestSlug: link.slug,
          label: link.label ?? null,
          position: index,
        })),
      );
    }

    return true;
  });

  if (saved) await refreshLibrary();

  return saved;
}

/**
 * Store an uploaded file set, replacing whatever was there.
 *
 * The author uploads a folder, and a folder is one act: what arrives is the
 * whole set, so anything that used to be in it and is not in the upload is gone.
 * Every path is checked before anything is written, so a set with one bad file
 * is refused whole rather than half-applied.
 */
export async function replaceFiles(
  slug: string,
  files: readonly JudgeFile[],
): Promise<string[]> {
  if (files.length === 0) return ["没有收到任何文件"];

  const problemsSeen: string[] = [];
  const paths = new Set<string>();

  for (const file of files) {
    const issue = judgeFileProblem(file);
    if (issue) problemsSeen.push(issue);
    if (paths.has(file.path)) problemsSeen.push(`${file.path} 出现了两次`);
    paths.add(file.path);
  }

  if (problemsSeen.length > 0) return problemsSeen;

  // A file set belongs to a problem this deployment authored. Writing one for a
  // repository problem would be a foreign key away from a constraint error, and
  // would put rows in `problem_files` that nothing ever reads.
  if (!(await authoredExists(slug))) return ["没有这道题"];

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(problemFiles).where(eq(problemFiles.problemSlug, slug));
    await tx.insert(problemFiles).values(rowsFor(slug, files, now));
  });

  return [];
}

/**
 * Make a draft reachable: validate it, mark it published, and reload the overlay.
 *
 * Validation happens here rather than only in the form because publishing is the
 * gate the platform's invariants sit behind, and a form is not an enforcement
 * point. The reload is what makes the problem playable immediately — the
 * registries read the overlay, not the table.
 */
export async function publishDraft(slug: string): Promise<DraftIssues | null> {
  const view = await draftFor(slug);
  if (!view) return null;

  const issues = checkDraft(view.draft, view.files, { publishing: true, selfSlug: slug });
  if (issues.errors.length > 0) return issues;

  await db
    .update(problems)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(problems.slug, slug));

  await refreshLibrary();
  return issues;
}

/** Take a problem out of circulation without losing the draft. */
export async function unpublishDraft(slug: string): Promise<void> {
  await db
    .update(problems)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(problems.slug, slug));

  await refreshLibrary();
}

/**
 * How many submissions refer to this problem.
 *
 * The key from `submissions` is RESTRICT, so this is also the count that decides
 * whether the problem can be deleted at all.
 */
export async function submissionCount(slug: string): Promise<number> {
  const [row] = await db
    .select({ held: count() })
    .from(submissions)
    .where(eq(submissions.problemSlug, slug));

  return row?.held ?? 0;
}

export type DeleteDraftResult =
  | { kind: "deleted"; submissions: number }
  | { kind: "missing" };

/**
 * Delete a problem and everything that belongs to it, the submissions included.
 *
 * The key from `submissions` is RESTRICT, and it stays that way on purpose. This
 * loss is deliberate, so it is written here where it can be read rather than
 * delegated to the schema: a cascade on the database would make every future
 * delete of a problem destroy contest history without anyone saying so. Deleting
 * the submissions inside the same transaction also takes the queue entries and
 * judging attempts that name them, which is what those keys already do.
 *
 * Only an authored problem is deleted. `slug` arrives from a form, so without
 * that guard a hand-written request naming a repository problem would delete its
 * mirror row — and, with it, every submission that refers to that problem.
 */
export async function deleteDraft(slug: string): Promise<DeleteDraftResult> {
  const held = await submissionCount(slug);

  const deleted = await db.transaction(async (tx) => {
    const authored = await tx
      .select({ slug: problems.slug })
      .from(problems)
      .where(and(eq(problems.slug, slug), isNotNull(problems.status)))
      .limit(1);

    if (authored.length === 0) return [];

    // The submissions go first: their key is what refuses the delete below.
    await tx.delete(submissions).where(eq(submissions.problemSlug, slug));

    return tx
      .delete(problems)
      .where(eq(problems.slug, slug))
      .returning({ slug: problems.slug });
  });

  if (deleted.length === 0) return { kind: "missing" };

  await refreshLibrary();
  return { kind: "deleted", submissions: held };
}
