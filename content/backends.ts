import { fromEnv } from "@/lib/backend/env";
import type { ProblemBackend } from "@/lib/backend/types";

/**
 * The problem backends this deployment runs.
 *
 * A problem's `backend.id` selects an entry here. Adding a backend means
 * adding a key — the kernel neither knows nor cares what the service does with
 * the payload it forwards, and it finds this file through
 * `content-backend-modules.ts` rather than importing it by name.
 *
 * Only the problems that genuinely need a service are here. Three entries used
 * to live alongside these and no longer do — `flag-checker`, `output-only` and
 * `roulette` — because none of them needed anything this file provides.
 * Judging them takes nothing the kernel does not already hold: the submission,
 * the problem's own config, and who submitted. They are now inline judges in
 * `content/problems/_shared/judge/`, and with them went three URLs, three
 * secrets and three deployments.
 *
 * The test for whether something belongs here is whether the judgement needs
 * **isolation** (it runs what the competitor submitted), **resources** (a time
 * or memory limit worth measuring), or **state the kernel does not hold** (a
 * container, a flag minted when that container was handed out). Every entry
 * below is here for one of those three reasons; anything else is inline.
 *
 * `fromEnv` reads `FOI_BACKEND_<NAME>_URL` and `FOI_BACKEND_<NAME>_SECRET`,
 * falling back to the local mock's address outside production.
 */
export const backends: Record<string, ProblemBackend> = {
  traditional: fromEnv("traditional"),
  interactive: fromEnv("interactive"),
  // A timed problem cannot share a machine with anything else without changing
  // the number being measured, so this queue is a serial one and it runs long:
  // a warmup plus three timed runs at an 8s limit, against a baseline judged
  // the same way. That used to need a thirty-minute `abandonAfterMs`, because
  // the kernel gave up on anything older than ten. It needs nothing now: a
  // runner heartbeating through a long evaluation keeps its job for as long as
  // it takes, and the kernel never has to know how long that is.
  performance: fromEnv("performance"),
  // The one entry that genuinely needs its address, and the reason `url`
  // survives at all. It hands out containers, so `spawn`/`poll`/`destroy` are
  // synchronous requests the kernel makes on a player's behalf — there is no
  // pulling those. Its own entry rather than a shared checker because it also
  // verifies the flags those containers mint; see its `problem.ts`.
  //
  // Two-phase, which is why ten seconds is enough: `spawn` returns straight
  // away and a `poll` action follows the container to ready.
  "leaky-bucket": fromEnv("leaky-bucket"),
};
