/**
 * Where each problem backend lives.
 *
 * A problem's `backend.id` selects an entry here. Adding a backend means
 * adding a key — the kernel neither knows nor cares what the service does with
 * the payload it forwards.
 *
 * "Backend" rather than "judge" because judging is one of the things these
 * services do, not the only one: the same process that grades a submission is
 * also the one that would hand out a container for the problem, and it has to
 * be, since a per-instance flag is only known to whoever created the instance.
 * The judging half of the protocol keeps the `judge` name throughout, because
 * that half really is about judging.
 */
export interface ProblemBackend {
  url: string;
  /** Falls back to FOI_BACKEND_SECRET when a backend has no dedicated secret. */
  secret?: string;
  /** Milliseconds to wait for the backend to acknowledge a dispatch. */
  timeoutMs?: number;
}

/**
 * Reads the new name, then the old one.
 *
 * The fallback exists so that renaming these variables did not have to be
 * synchronised with a deploy: a running environment still set only
 * `FOI_JUDGE_*` and would otherwise have lost every backend address at once.
 * Drop it once the deployed environments have been updated.
 */
function backendUrl(name: string): string | undefined {
  return (
    process.env[`FOI_BACKEND_${name}_URL`] ??
    process.env[`FOI_JUDGE_${name}_URL`]
  );
}

export const backends: Record<string, ProblemBackend> = {
  traditional: {
    url: backendUrl("TRADITIONAL") ?? "http://localhost:4100",
  },
  "flag-checker": {
    url: backendUrl("FLAG_CHECKER") ?? "http://localhost:4100",
  },
  "output-only": {
    url: backendUrl("OUTPUT_ONLY") ?? "http://localhost:4100",
  },
  interactive: {
    url: backendUrl("INTERACTIVE") ?? "http://localhost:4100",
  },
  performance: {
    url: backendUrl("PERFORMANCE") ?? "http://localhost:4100",
  },
};
