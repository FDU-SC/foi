import "server-only";

import { eq } from "drizzle-orm";
import { authoring } from "@/lib/authoring/registry";
import { db } from "@/lib/db";
import {
  problemContests,
  problemFiles,
  problems,
  type ProblemRow,
} from "@/lib/db/schema";
import { log } from "@/lib/log";
import { JUDGE_FILE_ENCODING, type JudgeFile } from "./judge-file";
import { problemConfigSchema, type ProblemConfig } from "./types";

/**
 * Problems that were authored here rather than shipped in the repository,
 * as a snapshot the synchronous registries can read.
 *
 * ## Why a snapshot and not an async registry
 *
 * A problem reaches the platform through `problemBySlug`, `allProblems` and the
 * (contest, problem) pairs built from them — all synchronous, all called from
 * module scope and from render. Reading the database is not, so an authored
 * problem is loaded into this overlay once and those readers keep their shape.
 *
 * The snapshot is refreshed at boot and whenever an author publishes, which is
 * what makes a published problem immediately playable; `startLibraryRefresh`
 * covers the process that published nothing. `generation` increments on every
 * refresh so derivations that cache against it — the (contest, problem) pair
 * index, the backend reverse index — know to rebuild.
 *
 * ## One snapshot per process, not per module
 *
 * The state lives on `globalThis`; see `current` below for why that is not a
 * detail.
 *
 * ## A broken row stays broken alone
 *
 * A row that no longer parses is dropped with a warning instead of throwing.
 * The filesystem registry refuses to boot on a bad config because a build that
 * produced one is a build to fix; a row is edited live, and taking the whole
 * site down over one is worse than leaving one problem unreachable.
 */

export interface LibraryLink {
  slug: string;
  label: string | null;
  position: number;
}

interface LibrarySnapshot {
  generation: number;

  problems: Map<string, ProblemConfig>;

  /** The statement MDX, by slug. */
  statements: Map<string, string>;

  /** The contests each problem was put in, by contest slug. */
  links: Map<string, LibraryLink[]>;
}

declare global {
  var __foiLibrary: LibrarySnapshot | undefined;
  var __foiLibraryGeneration: number | undefined;
  var __foiLibraryRefresh: (() => void) | undefined;
}

function empty(generation: number): LibrarySnapshot {
  return {
    generation,
    problems: new Map(),
    statements: new Map(),
    links: new Map(),
  };
}

/**
 * The snapshot lives on `globalThis`, not in a module binding.
 *
 * A page and the route handler its form posts to do not always share a module
 * instance — a bundler may give them separate graphs — and a library snapshot
 * per module instance is a library that is visible to the page and invisible to
 * the submission it triggers. `globalThis` is the one store they do share in a
 * process, and it is what the platform already uses for its pool, its rate
 * limiters and its standings cache.
 */
function current(): LibrarySnapshot {
  return (globalThis.__foiLibrary ??= empty(globalThis.__foiLibraryGeneration ?? 0));
}

/**
 * Counts reloads, and never goes backwards.
 *
 * Derivations memoize on it — the (contest, problem) index, the backend reverse
 * index — so a generation that repeated a value would leave one of them holding
 * the older answer. `resetLibrary` bumps it rather than returning to zero.
 */
function nextGeneration(): number {
  return (globalThis.__foiLibraryGeneration =
    (globalThis.__foiLibraryGeneration ?? 0) + 1);
}

/**
 * How often a process reloads the snapshot on its own.
 *
 * Publishing reloads it in the process that published. Another instance of the
 * deployment has no way to hear about that, so it looks again on this interval
 * — the cadence the runner reaper already polls at, and for the same reason.
 *
 * The reload is driven from here rather than from a reader: reading a problem is
 * synchronous and happens on paths that must not touch the database at all, so a
 * read that quietly issued a query would change what those paths cost.
 */
export const LIBRARY_REFRESH_MS = 15_000;

/** Bumped by every refresh, so caches keyed on it can rebuild. */
export function libraryGeneration(): number {
  return current().generation;
}

export function libraryProblems(): ReadonlyMap<string, ProblemConfig> {
  return current().problems;
}

export function libraryProblem(slug: string): ProblemConfig | undefined {
  return current().problems.get(slug);
}

export function libraryStatement(slug: string): string | undefined {
  return current().statements.get(slug);
}

export function libraryLinksIn(contestSlug: string): readonly LibraryLink[] {
  return current().links.get(contestSlug) ?? [];
}

/**
 * Reload on an interval, replacing any timer a previous registration started.
 *
 * Unref'd, so a script or a test that happens to load this module is not kept
 * alive by it.
 */
export function startLibraryRefresh(
  intervalMs = LIBRARY_REFRESH_MS,
): () => void {
  globalThis.__foiLibraryRefresh?.();

  const timer = setInterval(() => {
    void refreshLibrary();
  }, intervalMs);
  timer.unref?.();

  const stop = () => clearInterval(timer);
  globalThis.__foiLibraryRefresh = stop;
  return stop;
}

/**
 * The judge files of one problem, as the judge reads them.
 *
 * A row's `size` is the decoded length rather than the length of the stored
 * string, so a base64 file reports the bytes it stands for — which is what the
 * form shows and what the console counts against the upload budget.
 */
function filesFor(
  rows: readonly (typeof problemFiles.$inferSelect)[],
): JudgeFile[] {
  return rows
    .map((row): JudgeFile =>
      row.encoding === JUDGE_FILE_ENCODING
        ? { path: row.path, content: row.content, encoding: JUDGE_FILE_ENCODING }
        : { path: row.path, content: row.content },
    )
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The `backend.config` the judge receives.
 *
 * Everything the author wrote stays as it was; the file array is added, because
 * it lives in a table of its own rather than in the config JSON. This is the
 * only place the platform composes them, so what the judge reads is the same
 * whether the problem came from the repository or from here.
 */
function backendConfig(row: ProblemRow, files: JudgeFile[]): unknown {
  const written = row.config;
  if (typeof written !== "object" || written === null || Array.isArray(written)) {
    return { files };
  }
  return { ...(written as Record<string, unknown>), files };
}

function configFrom(row: ProblemRow, files: JudgeFile[]): ProblemConfig | null {
  const parsed = problemConfigSchema.safeParse({
    slug: row.slug,
    title: row.title,
    maxScore: row.maxScore ?? undefined,
    backend: {
      id: row.backendId ?? authoring.authoredBackend,
      config: backendConfig(row, files),
    },
    ui: row.ui ?? undefined,
    viewsPreset: row.viewsPreset ?? undefined,
  });

  if (!parsed.success) {
    log.warn(
      { slug: row.slug, issues: parsed.error.issues },
      "库中的题目配置不合法，已跳过",
    );
    return null;
  }

  return parsed.data;
}

/**
 * Reload the overlay from the database.
 *
 * Absent rows and an unreachable database both leave the previous snapshot in
 * place: a refresh that fails must not silently empty the site's problem set.
 * Callers that truly need a fresh read still see the generation unchanged.
 */
export async function refreshLibrary(): Promise<void> {
  let rows: ProblemRow[];
  let fileRows: (typeof problemFiles.$inferSelect)[];
  let linkRows: (typeof problemContests.$inferSelect)[];

  try {
    rows = await db.select().from(problems).where(eq(problems.status, "published"));
    fileRows = await db.select().from(problemFiles);
    linkRows = await db.select().from(problemContests);
  } catch (error) {
    log.error({ err: error }, "读取库中题目失败，继续使用上一次的快照");
    return;
  }

  const filesBySlug = new Map<string, (typeof problemFiles.$inferSelect)[]>();
  for (const row of fileRows) {
    const list = filesBySlug.get(row.problemSlug);
    if (list) list.push(row);
    else filesBySlug.set(row.problemSlug, [row]);
  }

  const next: LibrarySnapshot = {
    generation: nextGeneration(),
    problems: new Map(),
    statements: new Map(),
    links: new Map(),
  };

  for (const row of rows) {
    const config = configFrom(row, filesFor(filesBySlug.get(row.slug) ?? []));
    if (!config) continue;

    next.problems.set(row.slug, config);
    if (row.statementMdx !== null) next.statements.set(row.slug, row.statementMdx);
  }

  for (const row of linkRows) {
    // A link to a problem that failed to parse would be a pair with no problem,
    // which the rest of the platform treats as a contradiction rather than a gap.
    if (!next.problems.has(row.problemSlug)) continue;

    const entry: LibraryLink = {
      slug: row.problemSlug,
      label: row.label,
      position: row.position,
    };
    const list = next.links.get(row.contestSlug);
    if (list) list.push(entry);
    else next.links.set(row.contestSlug, [entry]);
  }

  for (const list of next.links.values()) {
    list.sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug));
  }

  globalThis.__foiLibrary = next;

  log.info(
    { problems: next.problems.size, contests: next.links.size, generation: next.generation },
    "已载入库中的题目",
  );
}

/** Drop the overlay, for a test that wants the filesystem-only view back. */
export function resetLibrary(): void {
  globalThis.__foiLibrary = empty(nextGeneration());
}
