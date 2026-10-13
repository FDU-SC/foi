import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureContest } from "@/lib/db/mirror";
import { db } from "@/lib/db";
import {
  accounts,
  problemContests,
  problems,
  submissions,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { contestBySlug, contestProblemsOf } from "@/lib/contests/registry";
import { contestProblemRef } from "@/lib/contests/refs";
import {
  createDraft,
  deleteDraft,
  draftFor,
  checkDraft,
  publishDraft,
  replaceFiles,
  saveDraft,
  slugConflict,
  submissionCount,
  type DraftInput,
} from "./authoring";
import { libraryProblems, libraryStatement, refreshLibrary, resetLibrary } from "./library";
import { loadStatement, problemBySlug } from "./registry";
import { isInlineBackend } from "./types";

/**
 * Authoring a problem end to end, against a real database.
 *
 * The acceptance this covers is the one the plan names for its first slice: a
 * problem put in the library is playable online. Everything between the form and
 * the judge is exercised — the draft row, the file rows, the belonging row, the
 * publish, and the registry that reads all four back — because each is a place
 * the problem could exist without being reachable.
 *
 * What it deliberately does not cover is the judge itself: dispatching and
 * scoring live in the runner's own repository.
 */

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const SLUG = "authored-probe";
const CONTEST = "fixture-open";

const FILES = [
  { path: "run.sh", content: "#!/bin/sh\nprintf 'FOI_RESULT {}\\n'\n" },
  { path: "contestant.cpp", content: "int main() { return 0; }\n" },
  {
    path: "tests/data.bin",
    content: Buffer.from([0x00, 0xff, 0xfe, 0x80]).toString("base64"),
    encoding: "base64" as const,
  },
];

const DRAFT: DraftInput = {
  slug: SLUG,
  title: "库里的探针题",
  maxScore: 100,
  statementMdx: "# 探针\n\n正文。\n",
  ui: {},
  viewsPreset: "fixture-plain",
  script: "run.sh",
  contestant: "contestant.cpp",
  memoryLimitMb: 256,
  maxFileMb: 64,
  stackLimitMb: 32,
  addressSpace: "unbounded",
  seed: 7,
  resultRequired: false,
  cases: [{ name: "1", argv: ["${JOB_ID_SHA16}"], threads: undefined, timeLimitMs: 5000, maxScore: 100 }],
  contests: [{ slug: CONTEST, label: "Z" }],
};

/** The account and submission the delete tests need, so they clean up after themselves. */
const PROBE_ACCOUNT = "probe-delete-guard";
const PROBE_SUBMISSION = "sub_probe_delete_guard";

async function cleanUp() {
  await db.delete(submissions).where(eq(submissions.id, PROBE_SUBMISSION));
  await db.delete(problems).where(eq(problems.slug, SLUG));
  await db.delete(accounts).where(eq(accounts.username, PROBE_ACCOUNT));
}

describeDb("题库中的题目", () => {
  beforeAll(async () => {
    await cleanUp();
    resetLibrary();

    const contest = contestBySlug(CONTEST);
    if (!contest) throw new Error(`夹具里没有比赛 ${CONTEST}`);
    await ensureContest(contest);
  });

  afterAll(async () => {
    await cleanUp();
    resetLibrary();
  });

  it("草稿在发布前不进任何注册表", async () => {
    const created = await createDraft(SLUG, DRAFT.title, null);
    expect(created).toEqual({ kind: "created" });

    await replaceFiles(SLUG, FILES);

    const view = await draftFor(SLUG);
    expect(view?.status).toBe("draft");
    expect(view?.files.map((file) => file.path)).toEqual([
      "contestant.cpp",
      "run.sh",
      "tests/data.bin",
    ]);

    await saveDraft({ ...DRAFT, ui: {} } as never, [], { replaceFiles: false });
    await refreshLibrary();

    expect(libraryProblems().has(SLUG)).toBe(false);
    expect(problemBySlug(SLUG)).toBeUndefined();
    expect(contestProblemRef(CONTEST, SLUG)).toBeUndefined();
  });

  it("文件、测试点与归属都存得住，再读回来还是那一份", async () => {
    await saveDraft(DRAFT, [], { replaceFiles: false });

    const view = await draftFor(SLUG);
    expect(view).not.toBeNull();
    expect(view!.draft.script).toBe("run.sh");
    expect(view!.draft.contestant).toBe("contestant.cpp");
    expect(view!.draft.cases).toEqual(DRAFT.cases);
    expect(view!.draft.contests).toEqual([{ slug: CONTEST, label: "Z" }]);
    expect(checkDraft(view!.draft, view!.files, { selfSlug: SLUG })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("栈上限、地址空间、种子与结果要求都存得住，再读回来还是那一份", async () => {
    await saveDraft(DRAFT, [], { replaceFiles: false });

    const view = await draftFor(SLUG);
    expect(view!.draft.stackLimitMb).toBe(32);
    expect(view!.draft.addressSpace).toBe("unbounded");
    expect(view!.draft.seed).toBe(7);
    expect(view!.draft.resultRequired).toBe(false);
  });

  it("留空的栈上限与种子写成字段缺席，而不是写成默认值", async () => {
    // 缺席才是"要判题机的默认值"：把 8 MB 写死在行里，判题机以后改默认值就传不到这道题。
    const { stackLimitMb, addressSpace, seed, ...bare } = DRAFT;
    await saveDraft({ ...bare, slug: SLUG, resultRequired: true }, [], { replaceFiles: false });

    const [row] = await db.select().from(problems).where(eq(problems.slug, SLUG));
    const config = row!.config as Record<string, unknown>;

    expect("stackLimitMb" in config).toBe(false);
    expect("addressSpace" in config).toBe(false);
    expect("seed" in config).toBe(false);
    // 结果要求不同：勾选框没有"没填过"这个状态，所以它总是被写下来。
    expect(config.result).toEqual({ required: true });

    const view = await draftFor(SLUG);
    expect(view!.draft.stackLimitMb).toBeUndefined();
    expect(view!.draft.addressSpace).toBeUndefined();
    expect(view!.draft.seed).toBeUndefined();
    expect(view!.draft.resultRequired).toBe(true);
  });

  it("发布之后题目有地址、题面能编译、判题配置带着文件", async () => {
    const issues = await publishDraft(SLUG);
    expect(issues?.errors).toEqual([]);

    // 一对 (比赛, 题目)：URL、鉴权与提交都建立在它上面。
    const ref = contestProblemRef(CONTEST, SLUG);
    expect(ref).toBeDefined();
    expect(ref!.entry.label).toBe("Z");

    // 题目自己，以及它所属比赛的题单。
    const problem = problemBySlug(SLUG);
    expect(problem?.title).toBe(DRAFT.title);
    expect(contestProblemsOf(contestBySlug(CONTEST)!).at(-1)?.slug).toBe(SLUG);

    // 题面按 content/statements.tsx 的组件集合运行期编译。
    expect(libraryStatement(SLUG)).toBe(DRAFT.statementMdx);
    const Statement = await loadStatement(SLUG);
    expect(Statement).not.toBeNull();

    // 判题机拿到的是 config 加上文件表，与仓库里的题目同一个形状。
    expect(problem && !isInlineBackend(problem.backend)).toBe(true);
    const config = (problem!.backend as { config: { files: typeof FILES; script: string } }).config;
    expect(config.script).toBe("run.sh");
    expect(config.files.map((file) => file.path)).toEqual([
      "contestant.cpp",
      "run.sh",
      "tests/data.bin",
    ]);
    expect(config.files.find((file) => file.path === "tests/data.bin")?.encoding).toBe("base64");
  });

  it("另一张模块图也能看到已经载入的题目", async () => {
    // 页面和它表单 POST 到的路由处理器不共享模块实例，所以一份挂在模块绑定上的
    // 快照会「页面看得到、提交却说这道题不属于这场比赛」。状态挂在 globalThis 上，
    // 是同进程里两张图唯一共享的存储；这里重置模块注册表取一份新实例来核对。
    await refreshLibrary();
    expect(libraryProblems().has(SLUG)).toBe(true);

    vi.resetModules();
    const fresh = await import("./library");

    expect(fresh.libraryProblems().has(SLUG)).toBe(true);
    expect(fresh.libraryStatement(SLUG)).toBe(DRAFT.statementMdx);
  });

  it("保存已经发布的题目会立刻换掉线上那份", async () => {
    // 已发布题目的题面与参数是从库快照里读的。保存如果不重载它，线上会一直
    // 显示上一版，直到别的事情碰巧刷新了快照 —— 这里刻意不手动刷新。
    await saveDraft({ ...DRAFT, statementMdx: "# 改过的\n" }, [], { replaceFiles: false });

    expect(libraryStatement(SLUG)).toBe("# 改过的\n");
  });

  it("下架之后地址消失，草稿还在", async () => {
    await db.update(problems).set({ status: "draft" }).where(eq(problems.slug, SLUG));
    await refreshLibrary();

    expect(contestProblemRef(CONTEST, SLUG)).toBeUndefined();
    expect(problemBySlug(SLUG)).toBeUndefined();
    expect((await draftFor(SLUG))?.status).toBe("draft");
  });

  it("删除会连提交记录一起带走", async () => {
    // `submissions.problem_slug` 是 RESTRICT，而且保持是 RESTRICT：这份损失是有意的，
    // 所以写在能读到的地方，而不是交给外键去悄悄级联。同事务里删掉提交，也就带走了
    // 指向它们的排队与评测记录。
    const [account] = await db
      .insert(accounts)
      .values({ username: PROBE_ACCOUNT, nickname: PROBE_ACCOUNT, status: "active" })
      .returning({ uid: accounts.uid });

    await db.insert(submissions).values({
      id: PROBE_SUBMISSION,
      uid: account!.uid,
      problemSlug: SLUG,
      contestSlug: CONTEST,
      payload: {},
      backendId: "common",
    });

    expect(await submissionCount(SLUG)).toBe(1);
    expect(await deleteDraft(SLUG)).toEqual({ kind: "deleted", submissions: 1 });

    expect(await draftFor(SLUG)).toBeNull();
    expect(await submissionCount(SLUG)).toBe(0);
    const left = await db
      .select()
      .from(problemContests)
      .where(eq(problemContests.problemSlug, SLUG));
    expect(left).toEqual([]);
  });

  it("删不存在的题目说它不存在，也没动没有 status 的镜像行", async () => {
    // slug 来自表单：手搓一个请求点名一道仓库题目时，它的镜像行和那份提交历史
    // 都不能被带走。
    const MIRRORED = "mirror-probe-delete";
    await db.insert(problems).values({ slug: MIRRORED, title: MIRRORED });

    expect(await deleteDraft("no-such-problem")).toEqual({ kind: "missing" });
    expect(await deleteDraft(MIRRORED)).toEqual({ kind: "missing" });

    const left = await db.select().from(problems).where(eq(problems.slug, MIRRORED));
    expect(left.map((row) => row.slug)).toEqual([MIRRORED]);

    await db.delete(problems).where(eq(problems.slug, MIRRORED));
  });
});

/**
 * What a slug collides with.
 *
 * The interesting one is the third: `problems` keeps a mirror row for anything a
 * submission points at, and a problem removed from the repository leaves that row
 * behind. The row is a primary key whether or not it is an authored problem, so
 * a create that treats it as free reaches the database and comes back as a
 * constraint violation the form cannot explain.
 */
describeDb("题目标识的占用", () => {
  const STALE = "leftover-probe";
  const MIRROR = "mirror-probe";

  async function forget() {
    await db.delete(problems).where(inArray(problems.slug, [STALE, MIRROR, SLUG]));
  }

  beforeAll(async () => {
    await forget();
    resetLibrary();
  });

  afterAll(async () => {
    await forget();
    resetLibrary();
  });

  it("仓库里的题目占着它的标识", async () => {
    const contest = contestBySlug(CONTEST)!;
    const entry = contestProblemsOf(contest)[0]!;

    expect(await slugConflict(entry.slug)).toBe("filesystem");
    expect(await slugConflict(STALE)).toBe(null);
  });

  it("自己出的题目占着自己的标识", async () => {
    expect(await createDraft(STALE, "占位", null)).toEqual({ kind: "created" });
    expect(await slugConflict(STALE)).toBe("authored");
    expect(await createDraft(STALE, "又一个", null)).toEqual({
      kind: "taken",
      conflict: "authored",
    });
  });

  it("只剩历史记录的标识不能被复用，也不该抛约束错误", async () => {
    // 已下架题目的镜像行：没有 status，但主键仍被它占着。
    await db.update(problems).set({ status: null }).where(eq(problems.slug, STALE));

    expect(await slugConflict(STALE)).toBe("history");
    expect(await createDraft(STALE, "复用", null)).toEqual({
      kind: "taken",
      conflict: "history",
    });

    // 而且它确实没有被改写。
    expect(await draftFor(STALE)).toBeNull();
  });

  it("保存一个不存在的草稿是「没有这道题」，而不是外键错误", async () => {
    expect(await saveDraft(DRAFT, [], { replaceFiles: false })).toBe(false);
    expect(await replaceFiles("no-such-draft", FILES)).toEqual(["没有这道题"]);
  });

  it("上传文件不会写进没有 status 的行里", async () => {
    await db.insert(problems).values({ slug: MIRROR, title: MIRROR });

    expect(await replaceFiles(MIRROR, FILES)).toEqual(["没有这道题"]);
  });
});
