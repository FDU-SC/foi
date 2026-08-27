import { makeRoom } from "@/lib/bounded-map";

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

interface Window {
  count: number;
  resetAt: number;
}

export interface FixedWindow {
  take(key: string, limit: number, windowMs: number): RateLimitResult;

  size(): number;
}

export interface FixedWindowOptions {

  maxKeys: number;
}

export function createFixedWindow(options: FixedWindowOptions): FixedWindow {
  const buckets = new Map<string, Window>();

  return {
    take(key, limit, windowMs) {
      const now = Date.now();

      const window = buckets.get(key);
      if (window && window.resetAt > now) {
        if (window.count >= limit) {
          return { ok: false, retryAfterMs: window.resetAt - now };
        }
        window.count += 1;
        return { ok: true };
      }

      if (buckets.size >= options.maxKeys) {
        makeRoom(buckets, (bucket) => bucket.resetAt, now, options.maxKeys);
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    },

    size: () => buckets.size,
  };
}
