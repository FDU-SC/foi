import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProblemStatementPreview } from "./problem-statement";

/**
 * The statement editor's preview.
 *
 * It renders through the same compile the published page uses, so what is worth
 * asserting here is the two things that make it a preview rather than a second
 * rendering path: it goes in the page (the platform refuses to be framed), and
 * its submit panel cannot submit.
 */

type Props = Parameters<typeof ProblemStatementPreview>[0];

async function render(overrides: Partial<Props> = {}): Promise<string> {
  return renderToStaticMarkup(
    await ProblemStatementPreview({
      slug: "authored-probe",
      title: "标题",
      maxScore: 100,
      ui: {},
      viewsPreset: "fixture-plain",
      contestSlug: "fixture-open",
      statementMdx: "# 标题\n\n正文。\n",
      ...overrides,
    }),
  );
}

describe("题面预览", () => {
  it("把题面渲染进页面，而不是套一层 iframe", async () => {
    const html = await render();

    expect(html).toContain("正文。");
    expect(html).not.toContain("<iframe");
  });

  it("部署提供的组件照常可用", async () => {
    expect(await render({ statementMdx: "<Box>盒子里的字</Box>\n" })).toContain("盒子里的字");
  });

  it("题面为空时说明情况，而不是渲染一个空盒子", async () => {
    expect(await render({ statementMdx: "   " })).toContain("题面还是空的。");
  });

  it("编译不了的题面在这里说明原因，而不是把整页带走", async () => {
    // 预览是编辑页上的一块面板。它编译失败时若把异常抛出去，作者的编辑区和
    // 表单上的校验信息会一起消失，而那正是他要用来修的东西。
    const html = await render({
      statementMdx: 'import { Callout } from "@/content/_shared/mdx/callout";\n\n<Box>嗯</Box>\n',
    });

    expect(html).toContain("这段题面无法渲染");
    expect(html).toContain("import");
  });

  it("预览里的提交面板被明确告知不能提交", () => {
    // 这条是结构断言而不是渲染断言：提交面板属于部署的组件集，夹具里没有它。
    // 但代价很实在 —— 一个能创建真实评测提交的"预览"不是预览。
    const source = readFileSync(
      join(import.meta.dirname, "problem-statement.tsx"),
      "utf8",
    );

    expect(source).toMatch(/allowed:\s*false/);
  });
});
