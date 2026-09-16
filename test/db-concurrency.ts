import { Client } from "pg";

/**
 * Hold a row from another connection until the operation is blocked on it.
 * The callback changes the committed state before the waiting operation resumes.
 */
export async function withLockedRow<T>(
  table: "submissions" | "judging_queue",
  id: string,
  operation: () => Promise<T>,
  beforeRelease: (client: Client) => Promise<void> = async () => {},
): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const observer = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await observer.connect();
  let pending: Promise<T> | undefined;
  try {
    await client.query("BEGIN");
    const key = table === "submissions" ? "id" : "submission_id";
    await client.query(`SELECT 1 FROM ${table} WHERE ${key} = $1 FOR UPDATE`, [id]);
    const { rows: [owner] } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    pending = operation();
    // Observe errors immediately even while waiting for the lock.
    void pending.catch(() => {});
    const deadline = Date.now() + 5_000;
    for (;;) {
      const { rows: [state] } = await observer.query<{ waiting: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting",
        [owner.pid],
      );
      if (state.waiting) break;
      if (Date.now() > deadline) throw new Error("操作未等待测试持有的行锁");
    }
    await beforeRelease(client);
    await client.query("COMMIT");
    return await pending;
  } finally {
    await client.query("ROLLBACK");
    await pending?.catch(() => {});
    await client.end();
    await observer.end();
  }
}
