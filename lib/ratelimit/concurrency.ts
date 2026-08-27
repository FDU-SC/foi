export interface Concurrency {

  acquire(key: string, max: number): (() => void) | null;

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

export const streamConcurrency = (globalThis.__foiStreamConcurrency ??=
  createConcurrency());

export const MAX_STREAMS_PER_UID = 5;
