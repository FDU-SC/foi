import type { ProblemViews } from "@/lib/problems/views";

/**
 * A declared value order that agrees with neither the catalogue order the
 * problems below hand it in, nor the frequency each value ends up with. Its
 * last rung is one no problem occupies, so it must not reach the filter bar.
 */
const LADDER = ["低", "中", "高", "极"];

/**
 * Keyed by slug: unlike the other tables, path parsing for views happens in
 * `_modules/`, so the platform already receives slugs here.
 *
 * Two dimensions with values, because filtering ORs inside one and ANDs across
 * them; one dimension nothing ever carries, which is what a deployment whose
 * problems all skip a field looks like; and one problem with no facets at all.
 */
export const problemViews: Record<string, ProblemViews> = {
  "fixture-external": {
    facets: () => [
      { key: "ranked", label: "分级", values: ["高", "外"], order: LADDER },
      { key: "marked", label: "标记", values: ["甲", "乙", "beta"] },
    ],
  },
  "fixture-inline": {
    verdicts: {
      accepted: { label: "通过", short: "AC", tone: "ok" },
      wrong_answer: { label: "答案错误", short: "WA", tone: "err" },
    },
    facets: () => [
      { key: "ranked", label: "分级", values: ["低"], order: LADDER },
      { key: "marked", label: "标记", values: ["甲", "乙"] },
    ],
  },
  "fixture-gated": {
    facets: () => [
      { key: "ranked", label: "分级", values: ["中"], order: LADDER },
      { key: "marked", label: "标记", values: ["乙", "alpha"] },
      { key: "blank", label: "空缺", values: [] },
    ],
  },
};
