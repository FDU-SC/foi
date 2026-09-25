import { fromEnv } from "@/lib/backend/env";
import type { ProblemBackend } from "@/lib/backend/types";

export const backends: Record<string, ProblemBackend> = {
  traditional: fromEnv("traditional"),

  /** makefile 驱动的通用判题机：题目自带 makefile 与驱动，平台只传配置。 */
  interactive: fromEnv("interactive"),

  "leaky-bucket": fromEnv("leaky-bucket"),
};
