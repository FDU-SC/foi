import { Client } from "pg";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/types";
import { log } from "@/lib/log";

const CHANNEL_PREFIX = "foi:sub:";

export interface NotifyPayload {
  state: string;
  runnerStatus?: string | null;
}

/**
 * Publish a submission state change via pg_notify.
 * Call inside a transaction (or standalone) after mutating state.
 */
export async function publish(
  on: DbOrTx,
  submissionId: string,
  payload: NotifyPayload,
): Promise<void> {
  const channel = `${CHANNEL_PREFIX}${submissionId}`;
  const body = JSON.stringify(payload);
  await on.execute(sql`select pg_notify(${channel}, ${body})`);
}

interface Subscriber {
  change: () => void;
  error: (error: unknown) => void;
}

interface Channel {
  subscribers: Set<Subscriber>;
  ready: Promise<void>;
}

interface Listener {
  client: Client;
  ready: Promise<void>;
  channels: Map<string, Channel>;
  closed: boolean;
}

declare global {
  // Keep the connection and its subscribers together across development reloads.
  var __foiSubmissionListener: Listener | undefined;
}

function fail(listener: Listener, error: unknown) {
  if (listener.closed) return;
  listener.closed = true;
  if (globalThis.__foiSubmissionListener === listener) {
    globalThis.__foiSubmissionListener = undefined;
  }
  const subscribers = [...listener.channels.values()].flatMap((c) => [...c.subscribers]);
  listener.channels.clear();
  log.error({ err: error }, "提交事件监听失败");
  for (const sub of subscribers) report(sub, error);
  void listener.client.end().catch(() => {});
}

function report(sub: Subscriber, error: unknown) {
  try {
    sub.error(error);
  } catch (error) {
    log.error({ err: error }, "提交事件订阅者退出失败");
  }
}

function listenerFor(): Listener {
  const existing = globalThis.__foiSubmissionListener;
  if (existing) return existing;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("缺少环境变量 DATABASE_URL");

  const client = new Client({
    connectionString, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, query_timeout: 10_000,
  });
  const listener: Listener = {
    client, channels: new Map(), closed: false, ready: Promise.resolve(),
  };
  globalThis.__foiSubmissionListener = listener;
  client.on("error", (error) => fail(listener, error));
  client.on("end", () => fail(listener, new Error("提交事件连接已关闭")));
  client.on("notification", (message) => {
    const channel = listener.channels.get(message.channel);
    if (!channel) return;
    // Notifications invalidate a snapshot; their payload is not a readable view.
    for (const sub of [...channel.subscribers]) {
      try {
        void Promise.resolve(sub.change()).catch((error) => report(sub, error));
      } catch (error) {
        report(sub, error);
      }
    }
  });
  listener.ready = client.connect().then(() => {});
  void listener.ready.catch((error) => fail(listener, error));
  return listener;
}

/** The channel is ready only after Postgres acknowledges LISTEN. */
export function subscribe(
  submissionId: string,
  change: () => void,
  error: (error: unknown) => void,
): { ready: Promise<void>; unsubscribe: () => void } {
  const listener = listenerFor();
  const name = `${CHANNEL_PREFIX}${submissionId}`;
  let channel = listener.channels.get(name);
  if (!channel) {
    channel = {
      subscribers: new Set(),
      ready: listener.ready.then(async () => {
        if (listener.closed) throw new Error("提交事件连接已关闭");
        await listener.client.query(`LISTEN ${quoteIdent(name)}`);
      }),
    };
    listener.channels.set(name, channel);
    void channel.ready.catch((error) => fail(listener, error));
  }
  const held = channel;
  const sub = { change, error };
  held.subscribers.add(sub);

  return {
    ready: held.ready,
    unsubscribe() {
      if (!held.subscribers.delete(sub)) return;
      // Reuse a pending LISTEN if another observer joins before it completes.
      void held.ready.then(async () => {
        if (listener.closed || held.subscribers.size > 0 || listener.channels.get(name) !== held) return;
        listener.channels.delete(name);
        if (listener.channels.size === 0) {
          listener.closed = true;
          if (globalThis.__foiSubmissionListener === listener) {
            globalThis.__foiSubmissionListener = undefined;
          }
          await listener.client.end();
        } else {
          // pg serializes queries, so a subsequent LISTEN follows this UNLISTEN.
          await listener.client.query(`UNLISTEN ${quoteIdent(name)}`);
        }
      }).catch((error) => fail(listener, error));
    },
  };
}

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}
