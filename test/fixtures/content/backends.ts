import type { ProblemBackend } from "@/lib/backend/types";

export const FIXTURE_BACKEND = "fixture-backend";

export const backends: Record<string, ProblemBackend> = {
  [FIXTURE_BACKEND]: {
    url: "http://backend.invalid",
    secret: "fixture-backend-secret",
  },
};
