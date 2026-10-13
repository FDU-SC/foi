import type { AuthoringConfig } from "@/lib/authoring/types";
import { FIXTURE_BACKEND } from "./backends";

/**
 * The fixture's authoring vocabulary.
 *
 * The ui field keys are the ones this fixture's problems actually carry, and
 * they are deliberately the same non-`difficulty`/`tags` keys the view registry
 * uses — a kernel test must not know which presentation fields a deployment
 * happens to offer.
 *
 * The presets carry one interpreter and one empty shape, so a kernel test can
 * tell "a preset was applied" from "the default was".
 */
export const authoring: AuthoringConfig = {
  defaultPreset: "fixture-plain",

  authoredBackend: FIXTURE_BACKEND,

  uiFields: [
    { key: "ranked", label: "分级", kind: "choice", options: [{ value: "高", label: "高" }] },
    { key: "marked", label: "标记", kind: "tags" },
  ],

  presets: [
    {
      id: "fixture-plain",
      label: "基础",
      description: "把结果原样读出来。",
      views: {
        describeResult: (result) => ({
          label: `preset:${String(result)}`,
          short: String(result),
          tone: "neutral",
        }),
      },
    },
    {
      id: "fixture-bare",
      label: "无解释",
      description: "不解释结果。",
      views: {},
    },
  ],
};
