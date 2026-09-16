import { sql } from "drizzle-orm";
import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { pool } from "./index";
import { readSnapshot } from "./read";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("数据库读取预算", () => {
  it("数据库执行语句超时，回滚后连接可复用且配置不泄漏", async () => {
    let pid = 0;
    await expect(readSnapshot(async (on) => {
      const configured = await on.execute<{ pid: number; isolation: string; readonly: string; timeout: string }>(sql`
        select pg_backend_pid() as pid,
          current_setting('transaction_isolation') as isolation,
          current_setting('transaction_read_only') as readonly,
          current_setting('statement_timeout') as timeout`);
      pid = configured.rows[0].pid;
      expect(configured.rows[0]).toMatchObject({ isolation: "repeatable read", readonly: "on", timeout: "5s" });
      await on.execute(sql`select pg_sleep(30)`);
    })).rejects.toMatchObject({ cause: { code: "57014" } });

    const client = await pool.connect();
    try {
      const { rows: [state] } = await client.query("select pg_backend_pid() as pid, current_setting('statement_timeout') as timeout");
      expect(state.pid).toBe(pid);
      expect(state.timeout).toBe("0");
      expect((await client.query("select 1 as ok")).rows[0].ok).toBe(1);
    } finally { client.release(); }
  }, 10_000);

  it("取消慢查询后销毁连接，数据库中的执行也会结束", async () => {
    const controller = new AbortController();
    const inspector = new Client({ connectionString: process.env.DATABASE_URL });
    await inspector.connect();
    let pid = 0;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const read = readSnapshot(async (on) => {
      const result = await on.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      pid = result.rows[0].pid;
      started();
      await on.execute(sql`select pg_sleep(30)`);
    }, controller.signal);
    const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
    try {
      await ready;
      const startedBy = Date.now() + 2000;
      for (;;) {
        const { rows: [state] } = await inspector.query("select wait_event from pg_stat_activity where pid = $1", [pid]);
        if (state?.wait_event === "PgSleep") break;
        if (Date.now() > startedBy) throw new Error("测试慢查询未开始执行");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      controller.abort();
      await rejected;
      // PostgreSQL may observe socket closure at its next interrupt; statement_timeout
      // bounds that delay as well. No application connection remains checked out.
      const deadline = Date.now() + 7000;
      for (;;) {
        const { rows: [state] } = await inspector.query("select exists(select 1 from pg_stat_activity where pid = $1) as alive", [pid]);
        if (!state.alive) break;
        if (Date.now() > deadline) throw new Error("取消后的数据库会话未结束");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(await readSnapshot(async (on) => (await on.execute(sql`select 1 as ok`)).rows[0])).toEqual({ ok: 1 });
    } finally {
      controller.abort();
      await inspector.end();
    }
  }, 10_000);

  it("连接池用尽时等待最多 5 秒，超时请求不留在等待队列", async () => {
    const held: PoolClient[] = [];
    try {
      for (let n = 0; n < 10; n++) held.push(await pool.connect());
      await expect(readSnapshot(async () => "unreachable")).rejects.toThrow(/timeout/i);
      expect(pool.waitingCount).toBe(0);
    } finally { held.forEach((client) => client.release()); }
    expect(await readSnapshot(async () => "available")).toBe("available");
  }, 10_000);
});
