import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { statementComponent, statementNeedsNoModuleSyntax } from "./statement";

/**
 * Compiling a statement that lives in the database.
 *
 * Both halves matter: the MDX pipeline has to run without a bundler, and a
 * component the deployment provides has to be reachable by name, since an
 * authored statement has nothing to import it from.
 */

describe("题面的编译", () => {
  it("没有 import 或 export 的题面才算合法", () => {
    expect(statementNeedsNoModuleSyntax("# 题目\n\n正文。\n")).toBe(true);
    expect(statementNeedsNoModuleSyntax('import { Callout } from "x"\n\n# 题目\n')).toBe(false);
    expect(statementNeedsNoModuleSyntax("export const x = 1\n\n# 题目\n")).toBe(false);
  });

  it("代码块里的 import/export 是例子，不是模块语法", () => {
    // 题面正是用代码块教人怎么跑：shell 的 `export OMP_NUM_THREADS=16` 和
    // Python 的 `import numpy as np`，按行扫原始 Markdown 会把它们当成 ESM 而
    // 拒绝掉整段合法的题面。
    const shell = "运行：\n\n```bash\nexport OMP_NUM_THREADS=16\n./solver\n```\n";
    expect(statementNeedsNoModuleSyntax(shell)).toBe(true);

    const fenced = "```python\nimport numpy as np\n```\n";
    expect(statementNeedsNoModuleSyntax(fenced)).toBe(true);

    const tilde = "~~~\nexport const x = 1\n~~~\n";
    expect(statementNeedsNoModuleSyntax(tilde)).toBe(true);
  });

  it("缩进代码块里的 import 同样是例子", () => {
    expect(statementNeedsNoModuleSyntax("示例：\n\n    import numpy as np\n")).toBe(true);
  });

  it("代码块结束之后的真 import 照样被拦", () => {
    const mixed = "```bash\nexport A=1\n```\n\nimport { Callout } from \"x\"\n";
    expect(statementNeedsNoModuleSyntax(mixed)).toBe(false);
  });

  it("没有闭合的围栏按代码读到结尾，不误伤也不放过", () => {
    expect(statementNeedsNoModuleSyntax("```\nimport numpy as np\n")).toBe(true);
    expect(statementNeedsNoModuleSyntax("```\nexport A=1\n\nimport x from \"y\"\n")).toBe(true);
  });

  it("markdown 会被渲染成元素", async () => {
    const Statement = await statementComponent("# 标题\n\n正文。\n");
    const html = renderToStaticMarkup(<Statement />);

    expect(html).toContain("标题");
    expect(html).toContain("正文。");
  });

  it("带代码块的题面能编译，且代码原样保留", async () => {
    const Statement = await statementComponent(
      "```bash\nexport OMP_NUM_THREADS=16\n```\n",
    );
    expect(renderToStaticMarkup(<Statement />)).toContain("OMP_NUM_THREADS");
  });

  it("部署提供的组件可以直接写，不需要引入", async () => {
    const Statement = await statementComponent("<Box>盒子里的字</Box>\n");
    expect(renderToStaticMarkup(<Statement />)).toContain("盒子里的字");
  });

  it("公式按 KaTeX 排版，与题面用的是同一条管线", async () => {
    const Statement = await statementComponent("行内 $x^2$ 与行间：\n\n$$\n\\frac{1}{2}\n$$\n");
    const html = renderToStaticMarkup(<Statement />);

    expect(html).toContain("katex");
  });

  it("表头拿到锚点 id，与仓库里的题面一致", async () => {
    const Statement = await statementComponent("## 任务描述\n");
    expect(renderToStaticMarkup(<Statement />)).toContain('id="任务描述"');
  });

  it("同一个题面只编译一次", async () => {
    const source = "# 只编译一次\n";
    const [first, second] = await Promise.all([
      statementComponent(source),
      statementComponent(source),
    ]);

    expect(first).toBe(second);
  });

  it("带 import 的题面编译时报错，而不是去解析模块", async () => {
    await expect(statementComponent('import x from "./x"\n\n# 题目\n')).rejects.toThrow(
      /不能包含 import 或 export/,
    );
  });
});
