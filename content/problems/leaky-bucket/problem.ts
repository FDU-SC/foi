import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "leaky-bucket",
  title: "Leaky Bucket",
  maxScore: 300,
  backend: {
    // On a backend rather than judged inline, and the reason is the one that
    // decides that question generally: the judgement needs state the kernel
    // does not hold. The flag belongs to one container and one person, minted
    // when that container was handed out, so the only party that can check it
    // is the party that created it. A per-player flag that could be *derived*
    // — `HMAC(secret, slug|handle)` — would need no service at all and would
    // belong inline; what pushes this one out is that the flag is minted fresh
    // per instance, so nothing can recompute it.
    id: "leaky-bucket",
    config: {
      // Never reaches the browser: `toPublicConfig` strips `backend` before the
      // config is handed to the client.
      image: "foi/chal-leaky-bucket:latest",
      lifetimeSeconds: 30 * 60,
    },
    actions: {
      // Two-phase: `spawn` answers at once with an id, `poll` follows it to
      // ready. Pulling an image takes longer than any request should be held
      // open, and a backend that holds one open is indistinguishable from a
      // backend that has died.
      //
      // Starting a container is expensive and there is no reason to want three
      // a minute; `poll` and `destroy` are cheap, and neither following an
      // instance nor freeing a slot should be the thing that is throttled.
      spawn: { rateLimit: { max: 3, windowSeconds: 60 } },
      poll: {},
      destroy: {},
    },
  },
  ui: {
    submit: "flag",
    placeholder: "FOI{...}",
    tags: ["Web", "Rate Limit"],
  } satisfies ProblemUi,
  order: 2,
} satisfies ProblemConfigInput;
