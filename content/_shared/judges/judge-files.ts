import "server-only";

/** One file of the common judge's `files`. Text only: `?raw` imports text. */
export interface JudgeFile {
  path: string;
  content: string;
}

const CODE_DIR = /(?:^|\/)code\/(.+)$/;

/**
 * A problem's `code/` directory as judge files, keyed by the path under `code/`.
 *
 * `import.meta.glob` only reads literal arguments, so each problem writes the
 * glob itself:
 *
 *   judgeFiles(import.meta.glob(["./code/*", "./code/**\/*"], {
 *     query: "?raw", import: "default", eager: true,
 *   }))
 *
 * The two patterns cover top-level and nested files whichever way the bundler
 * reads `**`; a file matched by both is one key.
 */
export function judgeFiles(modules: Record<string, unknown>): JudgeFile[] {
  const files = new Map<string, string>();

  for (const [key, value] of Object.entries(modules)) {
    const match = CODE_DIR.exec(key);
    if (!match) throw new Error(`judgeFiles：${key} 不在 code/ 目录下`);
    if (typeof value !== "string") {
      throw new Error(`judgeFiles：code/${match[1]} 没有作为文本导入，glob 需要 query: "?raw"`);
    }
    files.set(match[1], value);
  }

  if (files.size === 0) throw new Error("judgeFiles：code/ 目录为空");

  return [...files.keys()].sort().map((path) => ({ path, content: files.get(path)! }));
}
