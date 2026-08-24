import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "leaky-bucket",
  title: "Leaky Bucket",
  maxScore: 300,
  backend: {
    // Its own backend rather than the shared flag-checker: this problem hands
    // out containers, and whoever hands one out is the only party that knows
    // the flag inside it. Splitting orchestration from checking would mean
    // synchronising that mapping between two services.
    id: "leaky-bucket",
    config: {
      // Never reaches the browser: `toPublicConfig` strips `backend` before the
      // config is handed to the client.
      image: "foi/chal-leaky-bucket:latest",
      lifetimeSeconds: 30 * 60,
    },
    actions: {
      // Starting a container is expensive and there is no reason to want three
      // a minute; `destroy` is cheap and freeing a slot should never be the
      // thing that is throttled.
      spawn: { rateLimit: { max: 3, windowSeconds: 60 } },
      destroy: {},
    },
  },
  submit: { kind: "flag", placeholder: "FOI{...}" },
  tags: ["Web", "Rate Limit"],
  order: 2,
} satisfies ProblemConfigInput;
