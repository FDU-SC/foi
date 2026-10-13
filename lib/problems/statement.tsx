import "server-only";

import { evaluate, type EvaluateOptions } from "@mdx-js/mdx";
import type { MDXContent } from "mdx/types";
import { Fragment, type ComponentType, type ReactNode } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import rehypeKatex from "rehype-katex";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { statementComponents } from "@/content/statements";
import { useMDXComponents as elementStyles } from "@/mdx-components";

/**
 * Compile an authored problem statement at request time.
 *
 * A repository statement is a `.mdx` file the bundler compiled during the build.
 * An authored one is text in the database, so nothing has compiled it yet. This
 * runs the same pipeline `next.config.ts` configures — GFM, KaTeX, anchor ids
 * and highlighted fences — and hands the result the platform's element styles
 * plus the deployment's component set, which is what makes a preview and the
 * published page the same rendering rather than two that resemble each other.
 *
 * ## No imports, and why that is a rule rather than a limitation
 *
 * `content/statements.tsx` is the whole vocabulary: an authored statement writes
 * `<Callout>` because the deployment provides one, not because it imported one.
 * There is nothing for an import to resolve against here — no file on disk, no
 * bundler — so the authoring validator refuses `import` and `export` outright
 * and says which line, rather than letting the compiler fail with something
 * about module resolution.
 *
 * ## Cost
 *
 * Compiling pulls in the whole plugin chain, shiki included. Statements change
 * rarely and a page renders one of them, so the component is memoized by source
 * text: an edit produces a new key, and the old entry ages out with the process.
 */

type Statement = (props?: Record<string, unknown>) => ReactNode;

const compiled = new Map<string, Promise<Statement>>();

/**
 * The runtime functions the compiled body calls. `evaluate` insists on being
 * handed them rather than importing them itself, which keeps the compiled code
 * from reaching for a runtime the caller never chose.
 */
const COMPILE_OPTIONS: EvaluateOptions = {
  Fragment,
  jsx,
  jsxs,
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [
    rehypeSlug,
    [rehypeKatex, { strict: false, output: "html" }],
    [
      rehypePrettyCode,
      { theme: { light: "github-light", dark: "github-dark-dimmed" }, keepBackground: false },
    ],
  ],
};

/**
 * Whether the statement is free of ESM, so it can be compiled without a
 * filesystem to resolve an import against.
 *
 * A line-oriented scan rather than a parse, because its only job is to replace a
 * module-resolution failure with a sentence that says what to do. That means it
 * has to be permissive about anything that merely *looks* like a statement: code
 * blocks are where a problem documents `import numpy as np` or
 * `export OMP_NUM_THREADS=16`, and reading those as ESM would refuse a statement
 * for containing an example. Fences and indented blocks are Markdown's two ways
 * of quoting code, so both are skipped.
 *
 * A real `import` outside them still reaches the compiler, which refuses it with
 * a module error — a worse message, not a wrong answer.
 */
export function statementNeedsNoModuleSyntax(mdx: string): boolean {
  let fence: string | null = null;

  for (const line of mdx.split(/\r?\n/)) {
    const trimmed = line.trimStart();

    if (fence !== null) {
      // A closing fence is the same character, at least as long, on its own line.
      if (trimmed.startsWith(fence) && trimmed.slice(fence.length).trim() === "") {
        fence = null;
      }
      continue;
    }

    const opening = /^(`{3,}|~{3,})/.exec(trimmed);
    if (opening) {
      fence = opening[1]!;
      continue;
    }

    // Four spaces of indent is an indented code block in Markdown, so its
    // contents are an example too.
    if (line !== trimmed && line.length - trimmed.length >= 4) continue;

    if (/^(?:import|export)\b/.test(trimmed)) return false;
  }

  return true;
}

async function build(mdx: string): Promise<Statement> {
  if (!statementNeedsNoModuleSyntax(mdx)) {
    throw new Error(
      "题面不能包含 import 或 export：可用的组件已经全部提供，删掉这些行即可。",
    );
  }

  const { default: MDXContent } = (await evaluate(mdx, COMPILE_OPTIONS)) as {
    default: MDXContent;
  };

  // The compiled module takes its components as a prop rather than through a
  // provider, so the scope is closed over here and a caller keeps rendering
  // `<Statement />` exactly as it does for a repository problem.
  //
  // `elementStyles` is the root `mdx-components.tsx` export under the name Next
  // gives it. It returns a static table and holds no state, so calling it here
  // is reading a constant, not running a hook.
  const components = { ...elementStyles(), ...statementComponents };

  return function Statement() {
    return MDXContent({ components });
  };
}

/**
 * The component a page renders for an authored statement.
 *
 * A failed compile is not remembered: the next save fixes the text, and holding
 * a rejected promise would hide that.
 */
export function statementComponent(mdx: string): Promise<ComponentType> {
  const held = compiled.get(mdx);
  if (held) return held;

  const started = build(mdx);
  compiled.set(mdx, started);
  started.catch(() => compiled.delete(mdx));

  return started;
}
