import { fromEnv } from "@/lib/backend/env";
import type { ProblemBackend } from "@/lib/backend/types";

export const backends: Record<string, ProblemBackend> = {
  traditional: fromEnv("traditional"),

  /** 运行题目自带的判题脚本，见 FDU-SC/foi-runners 的 common/。 */
  common: fromEnv("common"),

  "leaky-bucket": fromEnv("leaky-bucket"),
};
