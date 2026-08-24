import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "leaky-bucket",
  title: "Leaky Bucket",
  maxScore: 300,
  backend: {
    id: "flag-checker",
    config: {
      // Never reaches the browser: `toPublicConfig` strips `backend` before the
      // config is handed to the client.
      mode: "static",
      expected: "FOI{r4te_l1m1t_bypa55ed}",
      caseSensitive: true,
    },
  },
  submit: { kind: "flag", placeholder: "FOI{...}" },
  tags: ["Web", "Rate Limit"],
  order: 2,
} satisfies ProblemConfigInput;
