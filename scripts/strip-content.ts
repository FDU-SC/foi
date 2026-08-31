/**
 * Strip every content root down to what the platform actually imports.
 *
 * The platform reaches content through a fixed set of entry points and nothing
 * else. Deleting the rest and then building proves it: if the platform still
 * compiles and boots with no problems, contests or policies present, then no
 * content semantics leaked into `lib/`, `app/` or `views/`.
 *
 * What survives is derived, never listed. The entry points are whatever `lib/`
 * imports from `@/content/...`, and from each of those this follows relative
 * imports to whatever else inside a content root it needs — `_modules/*.ts`
 * reaches `_globs.ts` that way, so the discovery files are kept without being
 * named here. Adding an entry point therefore needs no edit to this file, which
 * is the point: a hand-written list would drift the moment one is added, and
 * every fork carrying its own copy would drift twice.
 *
 * Run it against a throwaway checkout — it deletes files.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_ROOTS } from "../test/content-roots.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Extensions a specifier may omit, plus the ones it never does. */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".css"];

/** Only these are parsed for further imports; a stylesheet is a leaf. */
const PARSEABLE = /\.(?:tsx?|mts|m?js)$/;

const ENTRY_IMPORT = /(?:from|import)\s+["']@\/content\/([^"']+)["']/g;

const RELATIVE_IMPORT = /(?:from|import)\s+["'](\.[^"']*)["']/g;

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

/** The `@/content/...` specifiers `lib/` names, without the alias prefix. */
export function entrySpecifiers(root = ROOT): string[] {
  const found = new Set<string>();

  for (const file of walk(join(root, "lib"))) {
    if (!PARSEABLE.test(file) || /\.test\.tsx?$/.test(file)) continue;

    for (const [, specifier] of readFileSync(file, "utf8").matchAll(ENTRY_IMPORT)) {
      found.add(specifier!);
    }
  }

  return [...found].sort();
}

function resolveFile(path: string): string | null {
  if (existsSync(path) && statSync(path).isFile()) return path;

  for (const extension of EXTENSIONS) {
    if (existsSync(path + extension)) return path + extension;
  }
  for (const extension of EXTENSIONS) {
    const index = join(path, `index${extension}`);
    if (existsSync(index)) return index;
  }
  return null;
}

function within(file: string, directories: string[]): boolean {
  return directories.some((directory) => !relative(directory, file).startsWith(".."));
}

/**
 * Every file inside a content root the entry points reach, entry points
 * included. A fork's `_modules/` may point across roots at the upstream's
 * `_globs.ts`; that lands here too, because both roots count as inside.
 */
export function reachableFiles(root = ROOT): Set<string> {
  const roots = CONTENT_ROOTS.map((name) => join(root, name)).filter((path) =>
    existsSync(path),
  );

  const queue = entrySpecifiers(root).flatMap((specifier) =>
    roots.map((path) => resolveFile(join(path, specifier))).filter((f) => f !== null),
  );

  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    if (!PARSEABLE.test(file)) continue;

    for (const [, specifier] of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
      const target = resolveFile(resolve(dirname(file), specifier!));
      if (target && within(target, roots)) queue.push(target);
    }
  }

  return seen;
}

/**
 * Top-level names a root keeps. Deletion happens at that granularity, so a
 * reached file anywhere under a directory keeps the whole directory.
 */
export function keepIn(rootName: string, root = ROOT): Set<string> {
  const rootPath = join(root, rootName);

  const kept = [...reachableFiles(root)]
    .filter((file) => !relative(rootPath, file).startsWith(".."))
    .map((file) => relative(rootPath, file).split(sep)[0]!);

  return new Set(kept);
}

export function strip(root = ROOT): void {
  for (const rootName of CONTENT_ROOTS) {
    const rootPath = join(root, rootName);
    if (!existsSync(rootPath)) continue;

    const keep = keepIn(rootName, root);

    for (const entry of readdirSync(rootPath)) {
      if (keep.has(entry)) continue;
      rmSync(join(rootPath, entry), { recursive: true, force: true });
    }

    console.log(`[foi] ${rootName}/ 保留 ${[...keep].sort().join(" ")}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  strip();
}
