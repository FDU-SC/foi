import { fromEnv } from "@/lib/backend/env";
import type { ProblemBackend } from "@/lib/backend/types";

/**
 * One backend, named after nothing in particular.
 *
 * The name is the queue selector and the fragment of `FOI_BACKEND_<NAME>_URL`
 * / `_SECRET`, and it is otherwise meaningless to the kernel — which is the
 * point of it being called `example` here rather than after the problem that
 * uses it.
 *
 * It needs an address because `queued-echo` declares actions, and actions are
 * the one thing the kernel dials outward. Outside production `fromEnv` falls
 * back to the local mock, so a fresh checkout needs no configuration.
 */
export const backends: Record<string, ProblemBackend> = {
  example: fromEnv("example"),
};
