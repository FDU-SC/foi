import { describe, expect, it } from "vitest";
import { judgeFiles } from "./judge-files";
import { makefileJudge } from "./makefile";
import { stdioJudge } from "./stdio";

interface CommonCase {
  name: string;
  argv: string[];
  threads?: number;
  timeLimitMs: number;
  maxScore: number;
}

interface CommonConfig {
  files: { path: string; content: string }[];
  script: string;
  shell?: string;
  contestant?: string;
  cases: CommonCase[];
  memoryLimitMb: number;
  stackLimitMb?: number;
  addressSpace?: string;
}

describe("judgeFiles", () => {
  it("按 code/ 下的相对路径排序，同一文件只算一次", () => {
    const files = judgeFiles({
      "./code/makefile": "all:\n",
      "./code/include/api.h": "int f();\n",
      "./code/driver.cpp": "int main() {}\n",
    });
    expect(files.map((file) => file.path)).toEqual(["driver.cpp", "include/api.h", "makefile"]);
    expect(files[2]!.content).toBe("all:\n");
  });

  it("没有作为文本导入的文件、不在 code/ 下的文件与空目录都被拒绝", () => {
    expect(() => judgeFiles({ "./code/a.bin": { default: "x" } })).toThrow(/query: "\?raw"/);
    expect(() => judgeFiles({ "./other/a.txt": "x" })).toThrow(/不在 code\/ 目录下/);
    expect(() => judgeFiles({})).toThrow(/code\/ 目录为空/);
  });
});

describe("makefileJudge", () => {
  const backend = makefileJudge({
    files: [
      { path: "makefile", content: "all:\n" },
      { path: "driver.cpp", content: "int main() {}\n" },
    ],
    contestant: "contestant.cpp",
    build: { target: "all", artifact: "driver", timeLimitMs: 60_000, memoryLimitMb: 2048 },
    cases: [
      { name: "一", argv: ["./driver", "1"], threads: 4, timeLimitMs: 1000, maxScore: 30 },
      { name: "二", argv: ["./driver", "2"], timeLimitMs: 2000, maxScore: 70 },
    ],
    memoryLimitMb: 256,
    stackLimitMb: 16,
  });
  const config = backend.config as CommonConfig;

  it("编译预算只加在第一个测试点上，编译用更大的地址空间", () => {
    expect(config.cases.map((testCase) => testCase.timeLimitMs)).toEqual([61_000, 2000]);
    expect(config.memoryLimitMb).toBe(2048);
  });

  it("每个测试点运行前收紧到题目自己的预算：数据 + 每线程一份栈 + 16 MB", () => {
    expect(config.cases[0]!.argv.slice(0, 6)).toEqual([
      "30",
      String((256 + 4 * 16 + 16) * 1024),
      "0",
      "all",
      "driver",
      "contestant.cpp",
    ]);
    expect(config.cases[1]!.argv.slice(6)).toEqual(["./driver", "2"]);
  });

  it("缺少的选手文件补成占位，判题脚本附在最后", () => {
    expect(config.files.map((file) => file.path)).toEqual([
      "makefile",
      "driver.cpp",
      "contestant.cpp",
      config.script,
    ]);
    expect(config.contestant).toBe("contestant.cpp");
  });

  it("unbounded 时不收紧地址空间", () => {
    const unbounded = makefileJudge({
      files: [{ path: "makefile", content: "all:\n" }],
      contestant: "a.cu",
      contestantOwnsMain: true,
      build: { artifact: "a", timeLimitMs: 1, memoryLimitMb: 1 },
      cases: [{ name: "一", argv: ["./a"], timeLimitMs: 1, maxScore: 1 }],
      memoryLimitMb: 1,
      addressSpace: "unbounded",
    }).config as CommonConfig;
    expect(unbounded.cases[0]!.argv.slice(0, 4)).toEqual(["1", "unbounded", "1", "-"]);
    expect(unbounded.addressSpace).toBe("unbounded");
  });
});

describe("stdioJudge", () => {
  const files = [
    { path: "gen.cpp", content: "int main() {}\n" },
    { path: "std.cpp", content: "int main() {}\n" },
  ];
  const options = {
    files,
    generator: "gen.cpp",
    solution: "std.cpp",
    languages: ["cpp", "python"] as const,
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    subtasks: [
      { name: "小", score: 40, tests: 2 },
      { name: "大", score: 60, tests: 3 },
    ],
  };

  it("一个子任务一个测试点，题目描述写进 foi-stdio.json", () => {
    const config = stdioJudge({ ...options, languages: [...options.languages] }).config as CommonConfig;
    expect(config.cases.map((testCase) => [testCase.name, testCase.argv, testCase.maxScore])).toEqual([
      ["小", ["0"], 40],
      ["大", ["1"], 60],
    ]);
    expect(config.shell).toBe("python3");
    expect(config.contestant).toBeUndefined();
    expect(config.addressSpace).toBe("unbounded");

    const spec = JSON.parse(config.files.find((file) => file.path === "foi-stdio.json")!.content);
    expect(spec).toMatchObject({ languages: ["cpp", "python"], timeLimitMs: 1000, memoryLimitMb: 256 });
    expect(spec.subtasks).toEqual(options.subtasks);
  });

  it("files 里缺生成器或标程时拒绝", () => {
    expect(() =>
      stdioJudge({ ...options, languages: ["cpp"], files: files.slice(0, 1) }),
    ).toThrow(/std\.cpp/);
  });
});
