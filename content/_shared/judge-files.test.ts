import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JUDGE_FILE_BASE64_PREFIX, judgeFiles } from "./judge-files";

/**
 * Two halves.
 *
 * `judgeFiles` is pure, so the first half drives it with hand-built inputs —
 * that is the contract, described without depending on a bundler, which is also
 * why it cannot prove the loader works.
 *
 * The second half reads the real `code/` directories off disk. That is where the
 * regressions this shape actually had live: a `code/` file whose extension has no
 * Turbopack loader rule (the build then dies with "Unknown module type"), and
 * line endings (a CRLF checkout puts a `\r` at the end of every makefile recipe
 * line, where POSIX shells fold it into the last argument instead of treating it
 * as whitespace).
 *
 * Deliberately no `problem.ts` import: a problem config reaches its `files`
 * through `import.meta.glob`, which Vite cannot resolve for `.cpp`/`makefile`
 * (Turbopack resolves it through those very loader rules). Importing one would
 * stop this suite from even loading. So "does it compile" stays `next build`'s
 * job, and everything checkable without a build is checked here.
 */

/**
 * What `import.meta.glob` hands back for a file the loader processed: the bare
 * glob form, where the value is the module namespace and the string inside is
 * base64 behind the loader's sentinel.
 */
const loaded = (bytes: Buffer | string) => ({
  default:
    JUDGE_FILE_BASE64_PREFIX +
    (Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8")).toString("base64"),
  path: "x",
});

/** A value that resolved to a plain string, without the loader's sentinel. */
const mod = (text: string) => ({ default: text, path: "x" });

const SOURCE = {
  "./code/makefile": loaded("all:\n\tcc -o x x.c\n"),
  "./code/driver.cpp": loaded("int main() { return 0; }\n"),
  "./code/contestant.cpp": loaded("// committed placeholder\n"),
};

describe("judgeFiles", () => {
  it("把 glob 的 key 剪成评测机侧的相对路径", () => {
    const files = judgeFiles(SOURCE, { contestant: "contestant.cpp" });

    expect(files.map((f) => f.path)).toEqual([
      "contestant.cpp",
      "driver.cpp",
      "makefile",
    ]);
  });

  it("产出按路径排序，因为评测机按数组顺序落盘", () => {
    const shuffled = {
      "./code/makefile": SOURCE["./code/makefile"],
      "./code/contestant.cpp": SOURCE["./code/contestant.cpp"],
      "./code/driver.cpp": SOURCE["./code/driver.cpp"],
    };

    expect(judgeFiles(shuffled, { contestant: "contestant.cpp" }).map((f) => f.path)).toEqual(
      ["contestant.cpp", "driver.cpp", "makefile"],
    );
  });

  it("原样保留文件正文：真 Tab 不会被改写", () => {
    const files = judgeFiles(SOURCE, { contestant: "contestant.cpp" });
    const makefile = files.find((f) => f.path === "makefile")!;

    expect(makefile.content).toBe("all:\n\tcc -o x x.c\n");
    expect(makefile.content.split("\n")[1].charCodeAt(0)).toBe(9);
  });

  it("contestant 的内容被占位文本替换，因为评测机会覆盖它", () => {
    const files = judgeFiles(SOURCE, {
      contestant: "contestant.cpp",
      placeholder: "// 来自测试的占位\n",
    });

    expect(files.find((f) => f.path === "contestant.cpp")!.content).toBe(
      "// 来自测试的占位\n",
    );
  });

  it("占位文本默认非空，因为评测机拒绝空的 content", () => {
    const files = judgeFiles(SOURCE, { contestant: "contestant.cpp" });

    expect(files.find((f) => f.path === "contestant.cpp")!.content.length).toBeGreaterThan(0);
  });

  it("同时接受裸 glob 的命名空间、{ import: \"default\" } 的裸字符串与无哨兵的原样文本", () => {
    const forms = {
      "./code/makefile": loaded("all:\n"), // 裸 glob + loader
      "./code/driver.cpp": "int main() {}\n", // 无哨兵的原样文本
      "./code/contestant.cpp": mod("// x\n"), // 带 default 的命名空间，无哨兵
    };

    expect(
      judgeFiles(forms, { contestant: "contestant.cpp" }).map((f) => f.path),
    ).toEqual(["contestant.cpp", "driver.cpp", "makefile"]);
  });

  it("哨兵前缀与 loader 里的那一份一致", () => {
    // 一个 .cjs 文件和一个 .ts 文件之间没有别的连接，只能靠这条断言绑住。
    const loader = readFileSync(join(resolve(import.meta.dirname, "..", ".."), "tools", "judge-file-loader.cjs"), "utf8");

    expect(loader).toContain(`"${JUDGE_FILE_BASE64_PREFIX}"`);
  });

  it("code/ 为空时报错，而不是交出一份没有 makefile 的配置", () => {
    expect(() => judgeFiles({}, { contestant: "contestant.cpp" })).toThrow(/code\/ 目录是空的/);
  });

  it("contestant 不在文件集里时报错", () => {
    expect(() => judgeFiles(SOURCE, { contestant: "nope.cpp" })).toThrow(
      /contestant 指向 "nope\.cpp"/,
    );
  });

  it("value 不是字符串时报错，因为那意味着路径规则或 loader 没生效", () => {
    // 懒加载的 glob（漏了 eager）是真实会遇到的形状：值成了 thunk
    const broken = { ...SOURCE, "./code/data.bin": () => Promise.resolve("") };

    expect(() => judgeFiles(broken, { contestant: "contestant.cpp" })).toThrow(
      /data\.bin 不是字符串/,
    );
  });

  it("key 不在 code/ 下时报错，因为推不出评测机侧的路径", () => {
    const broken = { "./elsewhere/x.cpp": mod("x") };

    expect(() => judgeFiles(broken, { contestant: "contestant.cpp" })).toThrow(
      /不在 code\/ 目录下/,
    );
  });

  it("同一个相对路径出现两次时报错，而不是让后一个静默取胜", () => {
    // 相对路径是"最后一个 code/ 分段之后"的部分，所以嵌套的 code/ 会和
    // 顶层的 code/ 撞名——这正是要拦下的情况，否则哪个文件生效取决于数组顺序。
    const dup = { "./code/a.cpp": mod("1"), "./x/code/a.cpp": mod("2") };

    expect(() => judgeFiles(dup, { contestant: "a.cpp" })).toThrow(/出现了两次/);
  });

  it("嵌套目录保留相对路径，不只是取 basename", () => {
    const nested = {
      "./code/makefile": mod("all:\n"),
      "./code/contestant.cpp": mod("// x\n"),
      "./code/include/api.h": mod("#pragma once\n"),
    };

    expect(judgeFiles(nested, { contestant: "contestant.cpp" }).map((f) => f.path)).toEqual([
      "contestant.cpp",
      "include/api.h",
      "makefile",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 真实 code/ 目录
// ---------------------------------------------------------------------------

const problemsDir = resolve(import.meta.dirname, "..", "problems");

/**
 * Relative POSIX paths of everything under `dir`, at any depth.
 *
 * `root` stays the directory the caller asked about while `dir` walks down, or a
 * nested file would come back as `1.in` instead of `tests/1.in` and every
 * `join(dir, name)` below would look in the wrong place.
 */
function walk(dir: string, root: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, root));
    else if (entry.name !== ".gitkeep") out.push(relative(root, full).split("\\").join("/"));
  }
  return out.sort();
}

function codeDirOf(slug: string): string {
  return join(problemsDir, slug, "code");
}

/** Every problem directory that ships a `code/`. */
function slugsWithCode(): string[] {
  return readdirSync(problemsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => {
      try {
        readdirSync(codeDirOf(slug));
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Read as text rather than imported: reading the config would drag the bundler
 * in, and `contestant` is all this needs from it.
 */
function contestantOf(slug: string): string {
  const source = readFileSync(join(problemsDir, slug, "problem.ts"), "utf8");
  const match = source.match(/contestant:\s*"([^"]+)"/);
  if (!match) throw new Error(`${slug}/problem.ts 里找不到 contestant`);
  return match[1];
}

/**
 * The `makefile` a problem's config names, or null when it names none.
 *
 * Read as text for the same reason as `contestantOf`. `common` 判题机的题可以只有
 * 一个 sh 脚本——判题机不跑 `make`，是脚本自己决定怎么编译——所以"有 makefile"
 * 这件事只对声明了它的题目成立，makefile 自己的那些讲究（Tab、无 CR）也只在它
 * 存在时才谈得上。
 */
function makefileOf(slug: string): string | null {
  const source = readFileSync(join(problemsDir, slug, "problem.ts"), "utf8");
  const match = source.match(/makefile:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

const SLUGS = slugsWithCode();

describe("真实 code/ 目录", () => {
  it("至少有一道题用了 code/ 这个形状，脚本不会空过", () => {
    expect(SLUGS.length).toBeGreaterThan(0);
  });

  it.each(SLUGS)("%s：code/ 里必有 contestant；声明了 makefile 就必须有它", (slug) => {
    const names = walk(codeDirOf(slug));

    expect(names, `${slug}/code/ 里没有 ${contestantOf(slug)}`).toContain(contestantOf(slug));

    const makefile = makefileOf(slug);
    if (makefile !== null) {
      expect(names, `${slug}/code/ 里没有 ${makefile}`).toContain(makefile);
    }
  });

  it.each(SLUGS)("%s：contestant 的占位正文非空（评测机拒绝空 content）", (slug) => {
    const text = readFileSync(join(codeDirOf(slug), contestantOf(slug)), "utf8");

    expect(text.length).toBeGreaterThan(0);
  });

  it.each(SLUGS)("%s：判题文件不含 CR", (slug) => {
    const dir = codeDirOf(slug);
    for (const name of walk(dir)) {
      expect(
        readFileSync(join(dir, name), "utf8").includes("\r"),
        `${slug}/code/${name} 含 CR —— 发给评测机的字节会与开发机不一致`,
      ).toBe(false);
    }
  });

  it.each(SLUGS)("%s：makefile 的 recipe 行以真 Tab 开头", (slug) => {
    const dir = codeDirOf(slug);
    if (!walk(dir).includes("makefile")) return;

    // Makefile 里只有 recipe 必须、且只能以 Tab 开头。所以判据是：
    //   - 以 Tab 开头的行必须是命令，不能只是缩进的赋值；
    //   - 看起来像命令却以空格开头的行，就是有人把 Tab 换成了空格。
    const lines = readFileSync(join(dir, "makefile"), "utf8").split("\n");
    const isAssignment = (line: string) => /^[A-Za-z_][A-Za-z0-9_]*\s*[:+?]?=/.test(line);
    const isTarget = (line: string) => /^[A-Za-z0-9_./-]+\s*:(?!=)/.test(line);

    const tabbed = lines.filter((line) => line.charCodeAt(0) === 9);
    expect(tabbed.length, `${slug}/code/makefile 里没有任何 recipe 行`).toBeGreaterThan(0);

    for (const line of tabbed) {
      expect(
        isAssignment(line.slice(1).trimStart()),
        `${slug}/code/makefile: Tab 缩进的是赋值而不是命令: ${JSON.stringify(line)}`,
      ).toBe(false);
    }

    const misplaced = lines.filter(
      (line) =>
        /^ +\S/.test(line) &&
        !isAssignment(line.trimStart()) &&
        !isTarget(line.trimStart()) &&
        !line.trimStart().startsWith("#"),
    );
    expect(misplaced, `${slug}/code/makefile 里这些命令用了空格而不是 Tab`).toEqual([]);
  });

  it.each(SLUGS)("%s：每个判题文件都能被无损还原（文本原样，二进制走 base64）", (slug) => {
    const dir = codeDirOf(slug);
    const contestant = contestantOf(slug);

    // 用磁盘内容冒充 glob 的产物，这样测的是"真实文件能不能原样过去"
    const modules: Record<string, { default: string }> = {};
    for (const name of walk(dir)) {
      modules[`./code/${name}`] = loaded(readFileSync(join(dir, name)));
    }

    const files = judgeFiles(modules, { contestant });

    expect(files.map((f) => f.path)).toEqual(walk(dir));

    for (const file of files) {
      if (file.path === contestant) continue;

      const onDisk = readFileSync(join(dir, file.path));
      const sent =
        file.encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : Buffer.from(file.content, "utf8");

      // 这是整条链路唯一真正的验收标准：磁盘上的字节 == 发出去的字节。
      expect(sent.equals(onDisk), `${slug}/code/${file.path} 的字节在途中变了`).toBe(true);

      // 并且文本文件不该被 base64 白绕一圈——那会让配置变大且不可读。
      const isText = Buffer.from(onDisk.toString("utf8"), "utf8").equals(onDisk);
      expect(file.encoding === undefined, `${slug}/code/${file.path}`).toBe(isText);
    }

    const makefile = files.find((f) => f.path === "makefile");
    if (makefile !== undefined) {
      expect(
        makefile.content.split("\n").find((l) => l.charCodeAt(0) === 9),
        `${slug}/code/makefile 里没有 Tab 开头的 recipe`,
      ).toBeDefined();
    }
  });

  it("二进制文件走 base64，并且逐字节还原", () => {
    // 0x00 0xFF 0xFE 0x80 都不是合法 UTF-8 该有的东西，正是文本往返会毁掉它的证据。
    const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0x0a]);

    const files = judgeFiles(
      {
        "./code/makefile": loaded("all:\n"),
        "./code/contestant.cpp": loaded("// x\n"),
        "./code/testdata.bin": loaded(bytes),
      },
      { contestant: "contestant.cpp" },
    );

    const binary = files.find((f) => f.path === "testdata.bin")!;
    expect(binary.encoding).toBe("base64");
    expect(Buffer.from(binary.content, "base64").equals(bytes)).toBe(true);
  });

  it("含 NUL 的字节仍算文本（它是合法 UTF-8，往返保真）", () => {
    // NUL 看着像"二进制"，但 0x00 是合法 UTF-8，而且评测机把文本写回时用的
    // 就是 UTF-8——所以照文本发字节不变，还省掉 base64 的 33%。
    const bytes = Buffer.from("hello\u0000world", "utf8");

    const files = judgeFiles(
      {
        "./code/makefile": loaded("all:\n"),
        "./code/contestant.cpp": loaded("// x\n"),
        "./code/notes.txt": loaded(bytes),
      },
      { contestant: "contestant.cpp" },
    );

    const file = files.find((f) => f.path === "notes.txt")!;
    expect(file.encoding).toBeUndefined();
    expect(Buffer.from(file.content, "utf8").equals(bytes)).toBe(true);
  });

  it("无法无损 UTF-8 往返的字节走 base64", () => {
    // 未配对的代理项不会被 UTF-8 编码器接受，往返后必然不同——这才是真正的
    // 判据：不是"看着像二进制"，而是"作为字符串发出去会变"。
    const bytes = Buffer.from([0xed, 0xa0, 0x80, 0x41]); // 孤立的 U+D800 编码
    expect(Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)).toBe(false);

    const files = judgeFiles(
      {
        "./code/makefile": loaded("all:\n"),
        "./code/contestant.cpp": loaded("// x\n"),
        "./code/odd.bin": loaded(bytes),
      },
      { contestant: "contestant.cpp" },
    );

    const file = files.find((f) => f.path === "odd.bin")!;
    expect(file.encoding).toBe("base64");
    expect(Buffer.from(file.content, "base64").equals(bytes)).toBe(true);
  });

  it("非 ASCII 文本仍然是文本，不因为多字节就当成二进制", () => {
    const files = judgeFiles(
      {
        "./code/makefile": loaded("all:\n"),
        "./code/contestant.cpp": loaded("// x\n"),
        "./code/driver.cpp": loaded('printf("中文 ✓\\n");\n'),
      },
      { contestant: "contestant.cpp" },
    );

    const driver = files.find((f) => f.path === "driver.cpp")!;
    expect(driver.encoding).toBeUndefined();
    expect(driver.content).toBe('printf("中文 ✓\\n");\n');
  });

  it("glob 的两个模式合起来能覆盖任意文件，含无扩展名与嵌套", () => {
    // judgeFiles 只是消费 glob 的产物，所以这里用一批"以前白名单覆盖不到"的
    // 名字模拟它，确认 helper 不会因为扩展名或层级而拒绝任何一个。
    const exotic = {
      "./code/makefile": loaded("all:\n\tgen > out.txt\n"),
      "./code/gen": loaded("#!/bin/sh\necho hi\n"),
      "./code/params.toml": loaded("n = 10\n"),
      "./code/graph.csv": loaded("u,v\n1,2\n"),
      "./code/readme.md": loaded("# notes\n"),
      "./code/include/api.h": loaded("#pragma once\n"),
      "./code/nested/deep/thing.xyz": loaded("nope\n"),
      "./code/contestant.cpp": loaded("// placeholder\n"),
    };

    expect(judgeFiles(exotic, { contestant: "contestant.cpp" }).map((f) => f.path)).toEqual([
      "contestant.cpp",
      "gen",
      "graph.csv",
      "include/api.h",
      "makefile",
      "nested/deep/thing.xyz",
      "params.toml",
      "readme.md",
    ]);
  });

  it("同一相对路径的两个不同键仍然收敛成一个文件", () => {
    // 这是 `["./code/*", "./code/**/*"]` 重叠时可能产生的形状：两个键、同一
    // 相对路径。上面的用例把这种情况当错误拒绝；这里确认"同名覆盖"那种正常的
    // 重叠（同一个键）不会重复——键相同就是同一个属性。
    const sameKey = {
      "./code/makefile": mod("all:\n"),
      "./code/contestant.cpp": mod("// x\n"),
    };

    const files = judgeFiles(sameKey, { contestant: "contestant.cpp" });

    expect(files.map((f) => f.path)).toEqual(["contestant.cpp", "makefile"]);
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
  });
});
