import { fromEnv } from "@/lib/backend/env";
import type { ProblemBackend } from "@/lib/backend/types";

export const backends: Record<string, ProblemBackend> = {
  traditional: fromEnv("traditional"),
  interactive: fromEnv("interactive"),

  performance: fromEnv("performance"),

  "leaky-bucket": fromEnv("leaky-bucket"),
};
