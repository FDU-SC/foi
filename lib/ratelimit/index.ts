import { createFixedWindow, type RateLimitResult } from "./window";
import type { Bound } from "./policy";
import { isResolvedSource } from "@/lib/server/source";

export { sourceFrom } from "@/lib/server/source";

declare global {
  var __foiRateLimit: ReturnType<typeof createFixedWindow> | undefined;
}

const window = (globalThis.__foiRateLimit ??= createFixedWindow({

  maxKeys: 10_000,
}));

export type { Bound, RateLimitResult };

export function rateLimit(key: string, bound: Bound): RateLimitResult {
  return window.take(key, bound.max, bound.windowSeconds * 1000);
}

export function rateLimitBySource(
  activity: string,
  source: string,
  bound: Bound,
): RateLimitResult {
  if (!isResolvedSource(source)) return { ok: true };
  return rateLimit(`${activity}:${source}`, bound);
}
