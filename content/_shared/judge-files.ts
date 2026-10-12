import "server-only";

/**
 * Turn a problem's `code/` directory into the `files` array the judge expects.
 *
 * Before this, a problem's makefile and driver were template literals inside
 * `problem.ts`:
 *
 *   const MAKEFILE = `vadd: driver.cu kernel.cu
 *   \tnvcc -O2 -arch=native -o $@ $^
 *   `;
 *
 * Two things went wrong with that. Every backslash had to be doubled, so the
 * driver's `\n` in a `printf` became `\\n` and the makefile's recipe tab became
 * `\t` — or worse, a real tab that someone's editor silently converted to
 * spaces. And nothing about the file was real: no C++ highlighting, no makefile
 * highlighting, no lint.
 *
 * With this helper a problem keeps its judge sources as actual files:
 *
 *   content/problems/sssp-hpc/code/
 *     makefile        ← a real makefile, with a real tab
 *     driver.cpp      ← a real .cpp, where `\n` means `\n`
 *     contestant.cpp  ← placeholder, replaced by payload.source at judge time
 *
 * and `problem.ts` only wires them up:
 *
 *   const files = judgeFiles(
 *     // `?raw` keeps Vitest (Vite) from parsing a .cpp as JavaScript; Turbopack
 *     // ignores the option and applies its own `code/` rule instead.
 *     import.meta.glob(["./code/*", "./code/**\/*"], {
 *       query: "?raw",
 *       import: "default",
 *       eager: true,
 *     }),
 *     { contestant: "contestant.cpp" },
 *   );
 *
 * That glob is written out at each call site rather than exported from here,
 * because `import.meta.glob` has to be able to read its arguments statically and
 * does not accept them through a variable.
 *
 * ## Any file, not just the extensions someone listed
 *
 * The glob is `./code/*` *plus* `./code/**\/*` rather than one pattern, because
 * `**` matching zero directories is a glob-dialect detail rather than a
 * guarantee: the pair covers `code/makefile` and `code/include/api.h` whichever
 * way the bundler reads it, and the duplicate-path check below collapses
 * anything matched twice.
 *
 * Turbopack reads every one of these as text through a single rule keyed on the
 * path (`**\/code/**` in `next.config.ts`), so there is no list of permitted
 * extensions anywhere and a problem may keep a `.toml`, a `.csv`, or a script
 * with no extension at all.
 *
 * ## Why the bytes are baked in at build time
 *
 * `content/` is not copied into the runtime image (see the platform Dockerfile:
 * it copies `.next/standalone`, `static`, `public`, `drizzle`, `scripts`). So
 * the judge cannot read these files from disk, and a URL would have to be served
 * by something. `import.meta.glob` inlines them into the server bundle instead,
 * which is why this helper runs at module scope, when the problem registry is
 * built.
 *
 * ## Text and binary
 *
 * A problem may keep either in `code/`. JSON has no byte string, so a file travels
 * as a string plus an optional tag: text goes as itself (compactly, and legibly in
 * the stored config), anything else goes as base64 with `encoding: "base64"`.
 *
 * The choice is made here, per file, from the bytes — see `asText`. The loader
 * cannot make it, because by the time it has decoded to a JS string a wrong guess
 * is already unrecoverable; so it emits base64 always and this module decides.
 *
 * One exception is structural: the contestant file is overwritten with
 * `payload.source`, which is a JSON string, so it can only ever be text. The judge
 * refuses a config where that file claims otherwise.
 *
 * See `tools/judge-file-loader.cjs` for why `?raw` alone is not enough.
 */

/**
 * One file as the judge consumes it. Mirrors `MakeFile` in the judge's config.ts.
 *
 * JSON has no byte string, so a file travels as a string plus a tag saying how to
 * read it — the same shape the judge parses. Absent `encoding` means `content` is
 * the file's text; `"base64"` means it is the file's bytes encoded, for anything
 * that is not text.
 */
export interface JudgeFile {
  /** Path relative to the scratch directory the judge builds in. */
  path: string;
  /** The file's text, or its base64 bytes when `encoding` says so. */
  content: string;
  /** Absent for text, which is the common case. */
  encoding?: "base64";
}

export interface JudgeFilesOptions {
  /**
   * Basename of the file the contestant's submission is written to.
   *
   * Must name one of the globbed files, and is normally a committed placeholder
   * so the problem builds and reads correctly in the repository.
   */
  contestant: string;

  /**
   * Content for the contestant file in the bundle.
   *
   * Never reaches the judge: `judge.ts` writes `payload.source` over this path.
   * It does have to be non-empty, because the judge rejects an empty
   * `files[].content` before it ever gets that far.
   *
   * Text by construction. The submission arrives as a JSON string, so the judge
   * refuses a contestant entry that claims a non-text encoding.
   */
  placeholder?: string;
}

const DEFAULT_PLACEHOLDER = "// 评测时由选手提交覆盖\n";

/**
 * Marks the loader's output, so this module can tell bytes from text.
 *
 * `tools/judge-file-loader.cjs` always emits base64 — it has to, because a JS
 * string is UTF-16 and a wrong guess there is unrecoverable. Recognising that
 * output is then only half the job: most judge files *are* text, and sending
 * them as base64 would bloat the config each submission carries. So decode here,
 * where the bytes are intact and the choice is still reversible.
 *
 * The prefix is what makes the two forms distinguishable. Without it, a plain
 * text module and a base64 one are both just strings, and decoding the wrong one
 * would corrupt a file that was fine.
 *
 * Kept in step with `JUDGE_FILE_PREFIX` in the loader by a test, since nothing
 * else connects a `.cjs` file to this one.
 */
export const JUDGE_FILE_BASE64_PREFIX = "foi-judge-file:base64:";

/** How one `import.meta.glob` value was produced. */
type LoadedFile =
  | { kind: "text"; text: string }
  | { kind: "base64"; bytes: Buffer }
  | { kind: "unknown" };

/**
 * Turn one glob value into bytes, whichever shape the bundler produced.
 *
 * Three are accepted, because all three compile and a problem should not have to
 * know which one it got:
 *
 *   - the loader's output, `"foi-judge-file:base64:..."` (a bare glob);
 *   - a raw string, when the glob was given `{ query: "?raw", import: "default" }`
 *     and something resolved it without this loader;
 *   - anything else is a mistake this module will report, with the file named.
 */
function decode(module: unknown): LoadedFile {
  const value =
    typeof module === "object" && module !== null && "default" in module
      ? (module as { default: unknown }).default
      : module;

  if (typeof value !== "string") return { kind: "unknown" };
  if (!value.startsWith(JUDGE_FILE_BASE64_PREFIX)) return { kind: "text", text: value };

  const bytes = Buffer.from(value.slice(JUDGE_FILE_BASE64_PREFIX.length), "base64");
  return { kind: "base64", bytes };
}

/**
 * Whether these bytes can be carried as a JSON string without changing them.
 *
 * The test is exact rather than a sample of characters: decode as UTF-8, encode
 * back, compare. Anything that does not survive that round trip would arrive as
 * U+FFFD, and comparing buffers is what makes this a decision rather than a
 * heuristic — a file whose *extension* looks textual but whose bytes are not is
 * still caught, and one that merely looks binary (a NUL, say) is not needlessly
 * base64'd, because it round-trips exactly.
 */
function asText(bytes: Buffer): string | null {
  const text = bytes.toString("utf8");
  return Buffer.from(text, "utf8").equals(bytes) ? text : null;
}

/**
 * The `content`/`encoding` pair for one file, choosing text whenever the bytes
 * allow it so that the config stays readable and small.
 */
function encodeForWire(loaded: LoadedFile): Pick<JudgeFile, "content" | "encoding"> {
  if (loaded.kind === "text") return { content: loaded.text };

  if (loaded.kind === "base64") {
    const text = asText(loaded.bytes);
    return text === null
      ? { content: loaded.bytes.toString("base64"), encoding: "base64" }
      : { content: text };
  }

  /* c8 ignore next -- `unknown` is reported by the caller, which has the path. */
  throw new Error("unreachable");
}

/**
 * `import.meta.glob` keys are paths relative to the calling module, so every key
 * contains a `code/` segment. Turbopack's exact spelling is not contractual, and
 * a nested `code/` would break a naive `slice`, so key on the last `code/`.
 */
const CODE_SEGMENT = /(?:^|\/)code\//;

function relativePath(key: string): string {
  const match = CODE_SEGMENT.exec(key);
  if (!match) {
    throw new Error(
      `judgeFiles: "${key}" 不在 code/ 目录下，无法推出评测机侧的相对路径`,
    );
  }
  return key.slice(match.index + match[0].length);
}

/**
 * The wire form for one non-contestant file, or a diagnosis when the value is not
 * something this module can read.
 *
 * A non-string here means the loader rule did not apply — there is no longer any
 * "extension not registered" case, because the rule matches on the path.
 */
function wireFor(module: unknown, key: string): Pick<JudgeFile, "content" | "encoding"> {
  const loaded = decode(module);

  if (loaded.kind === "unknown") {
    const value =
      typeof module === "object" && module !== null && "default" in module
        ? (module as { default: unknown }).default
        : module;
    const loader = "tools/judge-file-loader.cjs";
    throw new Error(
      `judgeFiles: code/${relativePath(key)} 不是字符串（拿到 ${typeof value}）。` +
        `检查 next.config.ts 里匹配 code/ 的那条 turbopack 规则是否生效，` +
        `以及 ${loader} 是否正常加载。`,
    );
  }

  return encodeForWire(loaded);
}

/**
 * Build the judge's `files` array from a `code/` glob.
 *
 * @param modules `import.meta.glob(["./code/*", "./code/**\/*"], { eager: true })`
 *   — with or without a `query`/`import` option; all forms are read.
 */
export function judgeFiles(
  modules: Record<string, unknown>,
  options: JudgeFilesOptions,
): JudgeFile[] {
  const keys = Object.keys(modules);
  if (keys.length === 0) {
    throw new Error(
      "judgeFiles: code/ 目录是空的（或 glob 没匹配到任何文件）。" +
        "题目至少要有一份 makefile。",
    );
  }

  const contestant = relativePath(`code/${options.contestant}`);
  const seen = new Set<string>();
  const files: JudgeFile[] = keys.map((key) => {
    const path = relativePath(key);

    // Two keys for one path means the second silently wins, and which one the
    // makefile then sees would depend on glob order. The judge rejects this too;
    // failing here says which file is at fault.
    if (seen.has(path)) {
      throw new Error(`judgeFiles: code/ 里 ${path} 出现了两次`);
    }
    seen.add(path);

    return {
      path,
      // The contestant's entry is a string the judge overwrites, so whatever this
      // file happens to contain never travels. Its committed content still has to
      // be non-empty, which is why the placeholder exists.
      ...(path === contestant
        ? { content: options.placeholder ?? DEFAULT_PLACEHOLDER }
        : wireFor(modules[key], key)),
    };
  });

  if (!seen.has(contestant)) {
    throw new Error(
      `judgeFiles: contestant 指向 "${options.contestant}"，但 code/ 里没有这个文件`,
    );
  }

  // Glob order is not part of the contract, and the judge writes these files in
  // array order, so pin it to something deterministic.
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
