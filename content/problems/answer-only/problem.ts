import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "answer-only",
  title: "提交答案题示例 · 二进制中 1 的个数",
  maxScore: 100,
  backend: {
    id: "output-only",
    config: {
      // 期望答案按场景顺序。真实场景下这些数据由判题机从 testdata 读取，
      // 示例题直接内联——反正 backend.config 不会下发到浏览器。
      cases: [
        { name: "场景 1", expected: "8" },
        { name: "场景 2", expected: "1" },
        { name: "场景 3", expected: "16" },
      ],
    },
  },
  submit: { kind: "text", placeholder: "每行一个答案，按场景顺序" },
  tags: ["提交答案", "示例"],
  difficulty: "入门",
  order: 3,
} satisfies ProblemConfigInput;
