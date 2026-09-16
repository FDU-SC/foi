import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { publish, subscribe } from "./events";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const subscriptions: ReturnType<typeof subscribe>[] = [];

function watch(id: string) {
  const change = vi.fn();
  let changed!: () => void;
  let failed!: (error: unknown) => void;
  const notification = new Promise<void>((resolve) => { changed = resolve; });
  const failure = new Promise<unknown>((resolve) => { failed = resolve; });
  const sub = subscribe(id, () => { change(); changed(); }, failed);
  subscriptions.push(sub);
  return { ...sub, notification, failure, change };
}

afterEach(() => {
  subscriptions.splice(0).forEach((sub) => sub.unsubscribe());
});

describeDb("Postgres 提交通知", () => {
  it("回滚不发通知，提交后才唤醒订阅者", async () => {
    const sub = watch("sub_event_transaction");
    await sub.ready;
    await expect(db.transaction(async (tx) => {
      await publish(tx, "sub_event_transaction", { state: "judging" });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");

    await db.transaction(async (tx) => {
      await publish(tx, "sub_event_transaction", { state: "completed" });
      expect(sub.change).not.toHaveBeenCalled();
    });
    await sub.notification;
    expect(sub.change).toHaveBeenCalledTimes(1);
  });

  it("连接中断通知全部观察者，后续订阅可重新接收通知", async () => {
    const first = watch("sub_event_disconnect");
    const second = watch("sub_event_other");
    await Promise.all([first.ready, second.ready]);
    // Fault injection targets only this module's connection in the test database.
    const connection = globalThis.__foiSubmissionListener!.client;
    const { rows: [row] } = await connection.query<{ pid: number }>("select pg_backend_pid() as pid");
    await db.execute(sql`select pg_terminate_backend(${row.pid})`);
    expect(await first.failure).toBeInstanceOf(Error);
    expect(await second.failure).toBeInstanceOf(Error);

    const restored = watch("sub_event_disconnect");
    await restored.ready;
    await publish(db, "sub_event_disconnect", { state: "completed" });
    await restored.notification;
    expect(restored.change).toHaveBeenCalledTimes(1);
    expect(first.change).not.toHaveBeenCalled();
  });
});
