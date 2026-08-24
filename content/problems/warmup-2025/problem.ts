import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * 下架题目的示例。
 *
 * 这道题办完 2025 年那场热身赛就退役了，但目录留在仓库里——这不是懒得删，
 * 而是删掉之后 slug 就被释放了，下一个人建一个同名目录，历史提交会挂到新题
 * 名下。目录还在，文件系统就替我们挡住了这件事，不需要写任何检查。
 *
 * `retired` 和 `visibleTo` 是两条轴：这道题对所有人可见，做过它的人可以照常
 * 回看题面与自己的提交，它只是不再接受新提交、也不出现在题库列表里。想连题面
 * 一起收回，那是 `visibleTo: []`，另一回事。
 *
 * 真要彻底删除也可以，直接删目录即可；`submissions.problem_slug` 是
 * ON DELETE RESTRICT，会先让你面对那些历史提交。
 */
export const problem = {
  slug: "warmup-2025",
  title: "2025 热身赛 · 二进制中 1 的个数（已下架）",
  maxScore: 100,
  retired: true,
  backend: {
    id: "output-only",
    config: {
      cases: [
        { name: "场景 1", expected: "8" },
        { name: "场景 2", expected: "1" },
      ],
    },
    // 当年用它下发输入数据。下架之后这个接口和提交一起关掉——预览一道题不该
    // 启动它的容器，回看一道下架的题同样不该。两者走的是同一个判断。
    actions: { inputs: {} },
  },
  submit: { kind: "text", placeholder: "每行一个答案，按场景顺序" },
  tags: ["提交答案", "示例"],
  difficulty: "入门",
  order: 99,
} satisfies ProblemConfigInput;
