import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "game-of-life",
  title: "生命游戏 · 第一百代",
  maxScore: 100,
  backend: {
    id: "output-only",
    config: {
      // 第 100 代活细胞数（用程序模拟得到，手算不现实）。
      cases: [
        { name: "场景 1", expected: "14" },
        { name: "场景 2", expected: "12" },
        { name: "场景 3", expected: "14" },
      ],
    },
  },
  submit: {
    kind: "text",
    placeholder: "每行一个答案，按场景顺序",
  },
  tags: ["提交答案", "模拟", "趣味"],
  difficulty: "入门",
  order: 8,
} satisfies ProblemConfigInput;
