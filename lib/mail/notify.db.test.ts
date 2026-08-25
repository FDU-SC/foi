import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { redeemToken } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import { accounts, authTokens } from "@/lib/db/schema";
import type { MailMessage } from "./transport";
import { sendPasswordReset } from "./notify";

/**
 * What `sendPasswordReset` does to the rows around a send, which is the part
 * neither the token suite nor the two callers can see. The tokens next door
 * are tested against their own module; the actions under `app/` are tested
 * nowhere, by design. The ordering between minting, sending and retiring only
 * exists here.
 *
 * The relay is the one thing that has to be faked — a test cannot make a real
 * one refuse — so `deliver` is wrapped and everything else in `./transport`
 * left alone. Needs a real Postgres for the same reason the token suite does.
 */
const HANDLE = "resetmailtest";

const TO = {
  handle: HANDLE,
  displayName: "重置邮件测试",
  email: "reset-mail@example.test",
};

const relay = vi.hoisted(() => ({
  sent: [] as MailMessage[],
  refuse: false,
}));

vi.mock("./transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transport")>();
  return {
    ...actual,
    deliver: async (message: MailMessage) => {
      if (relay.refuse) throw new Error("中继拒收");
      relay.sent.push(message);
    },
  };
});

async function reachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const online = await reachable();
const describeDb = online ? describe : describe.skip;

if (!online) {
  console.warn("[test] 数据库不可达，跳过重置邮件集成用例");
}

/** The link as the person in front of the inbox would have it. */
function tokenFromLastMail(): string {
  const last = relay.sent.at(-1);
  if (!last) throw new Error("没有邮件发出");

  const url = last.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error("邮件正文里没有链接");

  const token = new URL(url).searchParams.get("token");
  if (!token) throw new Error("链接上没有 token");
  return token;
}

/** Past the per-account resend cooldown, so a test can send a second one. */
async function pastCooldown(): Promise<void> {
  await db.execute(
    sql`update auth_tokens set created_at = created_at - interval '61 seconds' where handle = ${HANDLE}`,
  );
}

async function cleanup(): Promise<void> {
  await db.delete(authTokens).where(eq(authTokens.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
}

describeDb("sendPasswordReset", () => {
  beforeEach(async () => {
    vi.stubEnv("FOI_PUBLIC_URL", "http://localhost:3000");
    relay.sent = [];
    relay.refuse = false;

    await cleanup();
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: TO.displayName,
      source: "registration",
    });
  });

  afterAll(async () => {
    await cleanup();
    vi.unstubAllEnvs();
  });

  it("中继拒收时，收件箱里那个旧链接还能用", async () => {
    await expect(sendPasswordReset(TO)).resolves.toMatchObject({ ok: true });
    const first = tokenFromLastMail();

    await pastCooldown();
    relay.refuse = true;
    await expect(sendPasswordReset(TO)).rejects.toThrow("中继拒收");

    // 第二封根本没离开这个进程，所以第一封那个链接必须还活着。先作废再
    // 发信的写法在这里会把这个人锁在外面：手上剩一个点开就说「链接无效」
    // 的链接，而要换一封得等中继恢复、冷却也过去——而中继下线恰恰是那个
    // 旧链接最要紧的时候。
    await expect(redeemToken(first, "password_reset")).resolves.toEqual({
      ok: true,
      handle: HANDLE,
    });
  });

  it("发出去之后旧链接才作废，不是干脆不作废了", async () => {
    await sendPasswordReset(TO);
    const first = tokenFromLastMail();

    await pastCooldown();
    await sendPasswordReset(TO);
    const second = tokenFromLastMail();

    expect(second).not.toBe(first);
    await expect(
      redeemToken(first, "password_reset"),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      redeemToken(second, "password_reset"),
    ).resolves.toMatchObject({ ok: true });
  });
});
