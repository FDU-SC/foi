import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeOutputOnly,
  type OutputOnlyConfig,
} from "../_shared/judge/output-only";

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
 *
 * 它也没有 `views.tsx`，同样是有意的。渲染插槽本就是可选的，不填就回落成格式化
 * JSON——一道题退役之后没人再维护它自己的渲染，历史提交长成那样是诚实的，不是
 * 缺了什么。真把目录删掉之后，那些提交走的也是这条路。
 */
export const problem = {
  slug: "warmup-2025",
  title: "2025 热身赛 · 二进制中 1 的个数（已下架）",
  maxScore: 100,
  retired: true,
  // 当年它还挂在 output-only 后端上，并用一个 `inputs` action 下发输入数据。
  // 那个后端被收回成内联判题之后，这里就没有服务可以转发了——内联判题没有
  // action。这不改变任何行为：`retired` 早就把 action 和提交一起关掉了。
  backend: {
    kind: "inline",
    judge: judgeOutputOnly,
    config: {
      cases: [
        { name: "场景 1", expected: "8" },
        { name: "场景 2", expected: "1" },
      ],
    } satisfies OutputOnlyConfig,
  },
  ui: {
    submit: "text",
    placeholder: "每行一个答案，按场景顺序",
    tags: ["提交答案", "示例"],
    difficulty: "入门",
  } satisfies ProblemUi,
  order: 99,
} satisfies ProblemConfigInput;
