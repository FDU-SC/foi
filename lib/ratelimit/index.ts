import {
  RateLimiterMemory,
  RateLimiterPostgres,
  RateLimiterRes,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import { pool } from "@/lib/db";
import { isResolvedSource } from "@/lib/server/source";
import type { Bound } from "./policy";

export { sourceFrom } from "@/lib/server/source";

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number };

declare global {
  var __foiRateLimiters: Map<string, RateLimiterAbstract> | undefined;
}

const limiters = (globalThis.__foiRateLimiters ??= new Map<
  string,
  RateLimiterAbstract
>());

function limiterFor(bound: Bound): RateLimiterAbstract {
  const id = `${bound.max}:${bound.windowSeconds}`;
  const held = limiters.get(id);
  if (held) return held;

  const points = bound.max;
  const duration = bound.windowSeconds;
  const memory = new RateLimiterMemory({
    points,
    duration,
    keyPrefix: `mem:${id}`,
  });

  const limiter =
    process.env.VITEST || process.env.NODE_ENV === "test"
      ? memory
      : new RateLimiterPostgres({
          storeClient: pool,
          storeType: "pool",
          points,
          duration,
          keyPrefix: `pg:${id}`,
          tableName: "rate_limits",
          tableCreated: true,
          clearExpiredByTimeout: true,
          insuranceLimiter: memory,
        });

  limiters.set(id, limiter);
  return limiter;
}

function rejected(error: unknown): RateLimitResult {
  if (error instanceof RateLimiterRes) {
    return { ok: false, retryAfterMs: error.msBeforeNext };
  }
  if (
    error &&
    typeof error === "object" &&
    "msBeforeNext" in error &&
    typeof error.msBeforeNext === "number"
  ) {
    return { ok: false, retryAfterMs: error.msBeforeNext };
  }
  throw error;
}

export type { Bound };

export async function rateLimit(
  key: string,
  bound: Bound,
): Promise<RateLimitResult> {
  try {
    await limiterFor(bound).consume(key);
    return { ok: true };
  } catch (error) {
    return rejected(error);
  }
}

export async function rateLimitBySource(
  activity: string,
  source: string,
  bound: Bound,
): Promise<RateLimitResult> {
  if (!isResolvedSource(source)) return { ok: true };
  return rateLimit(`${activity}:${source}`, bound);
}
