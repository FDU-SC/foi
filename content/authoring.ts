import { DIFFICULTIES, problemFacets } from "@/content/_shared/ui/problem-facets";
import { ProblemBadges } from "@/content/_shared/ui/problem-badges";
import { describeResult, progress } from "@/content/_shared/verdicts";
import { CodePayloadView } from "@/content/_shared/views/code-payload";
import { TextPayloadView } from "@/content/_shared/views/text-payload";
import { VerdictDetail } from "@/content/_shared/views/tests-table";
import type { AuthoringConfig } from "@/lib/authoring/types";

/**
 * What this deployment lets an author choose.
 *
 * The field keys are the ones `problemFacets` reads out of `problem.ui`, and the
 * languages are the ones `CodeInput` offers — an author picks from them rather
 * than typing a key the problem page would then ignore.
 */
const LANGUAGES = [
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "javascript", label: "JavaScript" },
];

/**
 * Two shapes, because this deployment's problems have two.
 *
 * 出题前端.md lists `perf` and `interactive` as well. Neither is a separate
 * shape here: every problem's `views.tsx` is the first entry below, and the
 * tests table it renders already reports time, memory and per-case score, so a
 * `perf` preset would be a second name for the same thing. `interactive` needs
 * the driver-packing backend, which authored problems do not use yet.
 */
export const authoring: AuthoringConfig = {
  defaultPreset: "default",

  /**
   * 通用判题机：题目自带一份 sh 脚本，判题机铺好文件就跑它。这是本部署唯一
   * 接受在线出题的后端——交互式那套要出题人自己维护打包与驱动，不适合表单。
   */
  authoredBackend: "common",

  uiFields: [
    {
      key: "difficulty",
      label: "难度",
      kind: "choice",
      options: DIFFICULTIES.map((value) => ({ value, label: value })),
    },
    { key: "tags", label: "标签", kind: "tags" },
    { key: "languages", label: "可选语言", kind: "multi", options: LANGUAGES },
    {
      key: "placeholder",
      label: "提交框提示",
      kind: "text",
      hint: "提交框为空时显示的说明。",
      placeholder: "例如：粘贴你的实现，不要写 main",
    },
  ],

  presets: [
    {
      id: "default",
      label: "代码提交 + 测试点",
      description: "提交框、逐测试点结果与个人进度。",
      views: {
        PayloadView: CodePayloadView,
        VerdictDetail,
        describeResult,
        progress,
        Badges: ProblemBadges,
        facets: problemFacets,
      },
    },
    {
      id: "answer-only",
      label: "只判正确性",
      description: "提交框与结果，不展示测试点明细。",
      views: {
        PayloadView: TextPayloadView,
        describeResult,
        progress,
        Badges: ProblemBadges,
        facets: problemFacets,
      },
    },
  ],
};
