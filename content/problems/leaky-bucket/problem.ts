import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "leaky-bucket",
  title: "Leaky Bucket",
  maxScore: 300,
  backend: {

    id: "leaky-bucket",
    config: {

      image: "foi/chal-leaky-bucket:latest",
      lifetimeSeconds: 30 * 60,
    },
    actions: {

      spawn: { rateLimit: { max: 3, windowSeconds: 60 } },
      poll: {},
      destroy: {},
    },
  },
  ui: {
    placeholder: "FOI{...}",
    tags: ["Web", "Rate Limit"],
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
