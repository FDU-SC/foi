import "server-only";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "./index";
import * as schema from "./schema";
import type { DbOrTx } from "./types";

/** A bounded, consistent platform read; interrupted connections are never reused. */
export async function readSnapshot<T>(
  read: (on: DbOrTx) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  // The pool also bounds connection establishment and checkout to five seconds.
  const client = await pool.connect();
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupt: (error: unknown) => void = () => {};
  const abort = () => interrupt(signal?.reason);

  try {
    signal?.throwIfAborted();
    const interrupted = new Promise<never>((_resolve, reject) => {
      interrupt = (error) => {
        if (released) return;
        released = true;
        // Destroy the socket, rather than just abandoning the query's Promise.
        client.release(true);
        reject(error);
      };
    });
    client.on("error", interrupt);
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => interrupt(new Error("数据库快照读取超时")), 10_000);

    const work = drizzle(client, { schema }).transaction(async (tx) => {
      // These settings roll back with the transaction and do not affect writers.
      await tx.execute(sql`select
        set_config('statement_timeout', '5s', true),
        set_config('lock_timeout', '2s', true),
        set_config('idle_in_transaction_session_timeout', '5s', true)`);
      return read(tx);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });

    return await Promise.race([work, interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    client.removeListener("error", interrupt);
    if (!released) client.release();
  }
}
