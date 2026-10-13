import { describe, expect, it } from "vitest";
import { checkDraft, type DraftInput, type ProblemFileView } from "./authoring";

/**
 * What a draft has to satisfy, and what is only worth mentioning.
 *
 * This is where the repository's invariants are restated for a problem that has
 * no directory: the slug may not collide with one that has, the byte round trip
 * becomes the encoding claim, and "some contest carries it" becomes a row. The
 * fixture supplies the shape — which contests exist, which backend is declared —
 * so nothing here names a deployment's own.
 */

const OPEN = "fixture-open";
const ARCHIVED = "fixture-archived";
const TAKEN = "fixture-external";

function files(...paths: string[]): ProblemFileView[] {
  return paths.map((path) => ({ path, encoding: null, size: 12 }));
}

type Case = DraftInput["cases"][number];

function oneCase(overrides: Partial<Case> = {}): Case {
  return { name: "1", argv: [], threads: undefined, timeLimitMs: 5000, maxScore: 100, ...overrides };
}

function draft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    slug: "authored-one",
    title: "在线出的题",
    maxScore: 100,
    statementMdx: "# 题目\n\n写点什么。\n",
    ui: {},
    viewsPreset: "fixture-plain",
    script: "run.sh",
    contestant: "contestant.cpp",
    memoryLimitMb: 256,
    maxFileMb: 64,
    resultRequired: true,
    cases: [oneCase()],
    contests: [{ slug: OPEN }],
    ...overrides,
  };
}

const GOOD_FILES = files("run.sh", "contestant.cpp");

describe("草稿的必填项", () => {
  it("一切就绪时没有任何问题", () => {
    expect(checkDraft(draft(), GOOD_FILES, { publishing: true })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("没有判题文件时说明缺什么", () => {
    const issues = checkDraft(draft(), [], { publishing: true });
    expect(issues.errors).toContain("还没有上传判题文件。");
  });

  it("判题脚本或提交落点不在已上传的文件里", () => {
    const issues = checkDraft(draft({ script: "nope.sh" }), GOOD_FILES, { publishing: true });
    expect(issues.errors.join()).toMatch(/nope\.sh/);
  });

  it("还没选判题脚本或提交落点时分别说明", () => {
    const issues = checkDraft(draft({ script: "", contestant: "" }), GOOD_FILES, {
      publishing: true,
    });
    expect(issues.errors.join()).toMatch(/还没有指定判题脚本/);
    expect(issues.errors.join()).toMatch(/还没有指定选手提交要覆盖的文件/);
  });

  it("选手提交的落点不能是二进制文件", () => {
    const withBinary = [
      { path: "run.sh", encoding: null, size: 12 },
      { path: "contestant.cpp", encoding: "base64" as const, size: 12 },
    ];
    expect(checkDraft(draft(), withBinary, { publishing: true }).errors.join()).toMatch(
      /不能作为选手提交的落点/,
    );
  });

  it("解释器不能填成已上传的判题文件", () => {
    // 判题机执行 `shell script`，而 shell 是从它自己的 PATH 上找的：填脚本名
    // 会变成"找不到解释器"，报错完全指不到这个设置。
    const issues = checkDraft(draft({ shell: "run.sh" }), GOOD_FILES, { publishing: true });
    expect(issues.errors.join()).toMatch(/不是解释器/);
  });

  it("解释器留空或填 sh 都不算问题", () => {
    expect(checkDraft(draft(), GOOD_FILES).errors).toEqual([]);
    expect(checkDraft(draft({ shell: "bash" }), GOOD_FILES).errors).toEqual([]);
  });

  it("栈合计超过数据预算时提醒，但不阻止发布", () => {
    // 判题机按「内存上限 + 线程数 × 栈上限 + 16」推导地址空间，两者不是独立的旋钮。
    const issues = checkDraft(
      draft({ memoryLimitMb: 256, stackLimitMb: 64, cases: [oneCase({ threads: 16 })] }),
      GOOD_FILES,
      { publishing: true },
    );

    expect(issues.errors).toEqual([]);
    expect(issues.warnings.join()).toMatch(/地址空间会被栈主导/);
  });

  it("栈合计在数据预算之内就不提", () => {
    const issues = checkDraft(
      draft({ memoryLimitMb: 1536, stackLimitMb: 8, cases: [oneCase({ threads: 16 })] }),
      GOOD_FILES,
    );

    expect(issues.warnings).toEqual([]);
  });

  it("没填栈上限时不去猜判题机的默认值", () => {
    const issues = checkDraft(
      draft({ memoryLimitMb: 16, cases: [oneCase({ threads: 32 })] }),
      GOOD_FILES,
    );

    expect(issues.warnings).toEqual([]);
  });

  it("题目标识不能和仓库里的题目撞名", () => {
    expect(
      checkDraft(draft({ slug: TAKEN }), GOOD_FILES, { publishing: true }).errors.join(),
    ).toMatch(/仓库里已经有题目/);
  });

  it("题目自己就是那个标识时不算撞名", () => {
    expect(
      checkDraft(draft({ slug: TAKEN }), GOOD_FILES, { publishing: true, selfSlug: TAKEN }).errors,
    ).toEqual([]);
  });

  it("题面不能自己 import 组件", () => {
    const issues = checkDraft(
      draft({ statementMdx: 'import { X } from "./x"\n\n# 题目\n' }),
      GOOD_FILES,
      { publishing: true },
    );
    expect(issues.errors.join()).toMatch(/import 或 export/);
  });

  it("没有测试点", () => {
    // 一张没有测试点的判题配置交给评测机只会白跑，所以它连草稿都算不上。
    expect(checkDraft(draft({ cases: [] }), GOOD_FILES, { publishing: true }).errors.join())
      .toMatch(/至少需要一个测试点/);
  });
});

describe("发布比草稿严", () => {
  const orphan = draft({ contests: [] });

  it("草稿允许还没有归属，只是提醒", () => {
    const issues = checkDraft(orphan, GOOD_FILES);
    expect(issues.errors).toEqual([]);
    expect(issues.warnings.join()).toMatch(/必须属于至少一场比赛/);
  });

  it("发布时没有归属就是错误", () => {
    expect(checkDraft(orphan, GOOD_FILES, { publishing: true }).errors.join()).toMatch(
      /必须属于至少一场比赛/,
    );
  });
});

describe("归属关系", () => {
  it("同一场比赛选两次是错误", () => {
    const issues = checkDraft(
      draft({ contests: [{ slug: OPEN }, { slug: OPEN }] }),
      GOOD_FILES,
      { publishing: true },
    );
    expect(issues.errors.join()).toMatch(/选了两次/);
  });

  it("编号重复是错误", () => {
    const issues = checkDraft(
      draft({
        contests: [
          { slug: OPEN, label: "A" },
          { slug: "fixture-main", label: "A" },
        ],
      }),
      GOOD_FILES,
      { publishing: true },
    );
    expect(issues.errors.join()).toMatch(/编号 "A" 重复/);
  });

  it("不存在的比赛是错误", () => {
    expect(
      checkDraft(draft({ contests: [{ slug: "no-such-contest" }] }), GOOD_FILES, {
        publishing: true,
      }).errors.join(),
    ).toMatch(/没有比赛/);
  });

  it("已经结束的比赛只是提醒", () => {
    const issues = checkDraft(draft({ contests: [{ slug: ARCHIVED }] }), GOOD_FILES, {
      publishing: true,
    });
    expect(issues.errors).toEqual([]);
    expect(issues.warnings.join()).toMatch(/已经结束/);
  });
});

describe("展示元数据按部署声明的字段检查", () => {
  it("字段不在声明里就报出来", () => {
    const issues = checkDraft(draft({ ui: { invented: "x" } }), GOOD_FILES);
    expect(issues.errors.join()).toMatch(/不是这套部署提供的字段/);
  });

  it("选择字段只能取声明的取值", () => {
    const issues = checkDraft(draft({ ui: { ranked: "不存在的一档" } }), GOOD_FILES);
    expect(issues.errors.join()).toMatch(/只能取/);
  });

  it("标签字段要一组字符串", () => {
    const issues = checkDraft(draft({ ui: { marked: [1, 2] } }), GOOD_FILES);
    expect(issues.errors.join()).toMatch(/需要一组标签/);
  });

  it("声明过的字段按声明取值就通过", () => {
    expect(checkDraft(draft({ ui: { ranked: "高", marked: ["甲"] } }), GOOD_FILES).errors)
      .toEqual([]);
  });
});

describe("提示而非拦阻", () => {
  it("题面为空只提醒", () => {
    const issues = checkDraft(draft({ statementMdx: "   " }), GOOD_FILES);
    expect(issues.errors).toEqual([]);
    expect(issues.warnings.join()).toMatch(/题面还是空的/);
  });

  it("preset 不再提供时说明会退回哪一个", () => {
    const issues = checkDraft(draft({ viewsPreset: "gone" }), GOOD_FILES);
    expect(issues.errors).toEqual([]);
    expect(issues.warnings.join()).toMatch(/不再提供/);
  });

  it("测试点分值超出总分时提醒，但不拦", () => {
    const issues = checkDraft(
      draft({
        maxScore: 10,
        cases: [{ name: "1", argv: [], threads: undefined, timeLimitMs: 1000, maxScore: 50 }],
      }),
      GOOD_FILES,
    );
    expect(issues.errors).toEqual([]);
    expect(issues.warnings.join()).toMatch(/超过题目总分/);
  });
});
