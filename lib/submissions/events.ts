import { Client } from "pg";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/accounts/queries";

declare global {
  var __foiPgListener: Client | undefined;
  var __foiPgListenerReady: Promise<void> | undefined;
}

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

type Handler = (payload: NotifyPayload) => void;

interface Subscription {
  channel: string;
  handler: Handler;
}

const subscriptions = new Map<string, Set<Subscription>>();

function getListenerClient(): Client {
  if (globalThis.__foiPgListener) return globalThis.__foiPgListener;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("缺少环境变量 DATABASE_URL");
  }

  const client = new Client({ connectionString });
  globalThis.__foiPgListener = client;

  globalThis.__foiPgListenerReady = client.connect().then(() => {
    client.on("notification", (msg) => {
      if (!msg.channel.startsWith(CHANNEL_PREFIX)) return;
      const subs = subscriptions.get(msg.channel);
      if (!subs || subs.size === 0) return;
      let parsed: NotifyPayload;
      try {
        parsed = JSON.parse(msg.payload ?? "{}") as NotifyPayload;
      } catch {
        return;
      }
      for (const sub of subs) {
        try {
          sub.handler(parsed);
        } catch {
          // swallow subscriber errors
        }
      }
    });

    client.on("error", (err) => {
      console.error("[foi] pg listener error", err);
    });
  });

  return client;
}

async function ensureReady(): Promise<Client> {
  const client = getListenerClient();
  await globalThis.__foiPgListenerReady;
  return client;
}

/**
 * Subscribe to notifications for a specific submission.
 * Returns an unsubscribe function.
 */
export function subscribe(
  submissionId: string,
  handler: Handler,
): () => void {
  const channel = `${CHANNEL_PREFIX}${submissionId}`;

  const sub: Subscription = { channel, handler };
  let set = subscriptions.get(channel);
  if (!set) {
    set = new Set();
    subscriptions.set(channel, set);
  }
  set.add(sub);

  const needsListen = set.size === 1;
  if (needsListen) {
    void ensureReady().then((client) => {
      if (subscriptions.get(channel)?.has(sub)) {
        client.query(`LISTEN ${quoteIdent(channel)}`).catch((err) => {
          console.error("[foi] LISTEN failed", err);
        });
      }
    });
  }

  return () => {
    set!.delete(sub);
    if (set!.size === 0) {
      subscriptions.delete(channel);
      void ensureReady().then((client) => {
        if (!subscriptions.has(channel)) {
          client.query(`UNLISTEN ${quoteIdent(channel)}`).catch(() => {});
        }
      });
    }
  };
}

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}
