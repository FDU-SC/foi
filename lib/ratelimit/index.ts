import { createFixedWindow, type RateLimitResult } from "./window";
import { isResolvedSource, sourceFrom } from "./source";

declare global {
  var __foiRateLimit: ReturnType<typeof createFixedWindow> | undefined;
}

const window = (globalThis.__foiRateLimit ??= createFixedWindow({

  maxKeys: 10_000,
}));

export type { RateLimitResult };

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  return window.take(key, limit, windowMs);
}

export { sourceFrom };

export function rateLimitBySource(
  activity: string,
  source: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  if (!isResolvedSource(source)) return { ok: true };
  return rateLimit(`${activity}:${source}`, limit, windowMs);
}
