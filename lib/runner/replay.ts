import { MAX_CLOCK_SKEW_SECONDS } from "@/lib/backend/signature";
import { makeRoom } from "@/lib/bounded-map";

export const REPLAY_TTL_MS = 2 * MAX_CLOCK_SKEW_SECONDS * 1000;

export interface ReplayWindow {

  firstUse(backendId: string, nonce: string): boolean;

  size(): number;
}

export interface ReplayWindowOptions {

  maxKeys: number;

  ttlMs?: number;
}

export function createReplayWindow(options: ReplayWindowOptions): ReplayWindow {
  const ttlMs = options.ttlMs ?? REPLAY_TTL_MS;

  const spent = new Map<string, number>();

  return {
    firstUse(backendId, nonce) {
      const now = Date.now();

      const key = `${backendId}:${nonce}`;

      const expiresAt = spent.get(key);
      if (expiresAt !== undefined && expiresAt > now) return false;

      if (spent.size >= options.maxKeys) {
        makeRoom(spent, (at) => at, now, options.maxKeys);
      }
      spent.set(key, now + ttlMs);
      return true;
    },

    size: () => spent.size,
  };
}

declare global {
  var __foiClaimNonces: ReplayWindow | undefined;
}

export const claimNonces: ReplayWindow = (globalThis.__foiClaimNonces ??=
  createReplayWindow({ maxKeys: 50_000 }));
