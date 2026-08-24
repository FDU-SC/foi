/**
 * How many of something one caller may hold at once.
 *
 * Not a rate, and that is why it could not be expressed with the counter next
 * door. A fixed window bounds how often something is *started*; this bounds
 * how many are *open*, which is the question an SSE stream asks. Opening one
 * connection a minute forever is fine; holding a thousand at once is not, and
 * `rateLimit` says yes to both.
 *
 * `/api/submissions/stream` is the case. Each open stream registers a listener
 * on the process-wide bus and a twenty-second heartbeat timer, and
 * `lib/submissions/events.ts` sets `setMaxListeners(0)` precisely so that
 * having many is not warned about. Nothing bounded how many one account could
 * open.
 *
 * The contract is a release function rather than a second call, because the
 * failure mode of the alternative is a slow leak: a path that forgets to
 * decrement leaves a caller permanently a little more limited until restart.
 * A `release` that is safe to call twice, handed back at acquire time, is the
 * shape hardest to get wrong from the caller's side.
 */

export interface Concurrency {
  /**
   * A release function, or null when `key` is already at `max`.
   *
   * Idempotent: an SSE stream can be closed by the verdict arriving, by the
   * client going away, and by the runtime tearing the response down, and more
   * than one of those happens on an ordinary request.
   */
  acquire(key: string, max: number): (() => void) | null;
  /** Live count for `key`. For tests, and for asserting nothing leaked. */
  held(key: string): number;
}

export function createConcurrency(): Concurrency {
  const held = new Map<string, number>();

  return {
    acquire(key, max) {
      const current = held.get(key) ?? 0;
      if (current >= max) return null;

      held.set(key, current + 1);

      let released = false;
      return () => {
        if (released) return;
        released = true;

        const remaining = (held.get(key) ?? 1) - 1;
        // Deleted rather than left at zero: the map is keyed by account, and a
        // zero entry per person who ever opened a stream is a leak that just
        // takes longer to notice.
        if (remaining <= 0) held.delete(key);
        else held.set(key, remaining);
      };
    },

    held: (key) => held.get(key) ?? 0,
  };
}

declare global {
  var __foiStreamConcurrency: Concurrency | undefined;
}

/**
 * Open SSE streams per account.
 *
 * On `globalThis` for the same reason the event bus is: Next can place a
 * module in more than one server bundle, and a second copy of this counter
 * would be a second allowance. Unlike the proxy's counter, this one is only
 * ever touched from route handlers, so there is no boundary it must not cross.
 */
export const streamConcurrency = (globalThis.__foiStreamConcurrency ??=
  createConcurrency());

/**
 * Streams one account may hold open at once.
 *
 * A person watching two submissions in two tabs is ordinary; a person holding
 * five is already unusual. Set where a real browser will not reach it and an
 * automated client will.
 */
export const MAX_STREAMS_PER_HANDLE = 5;
