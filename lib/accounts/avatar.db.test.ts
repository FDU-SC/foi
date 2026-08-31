import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accountAvatars, accounts } from "@/lib/db/schema";
import { clearAvatar, getAccount, getAvatar, setAvatar } from "./queries";

const USERNAME = "avatar-owner";
let UID = 0;

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
  console.warn("[test] 数据库不可达，跳过头像存取用例");
}

const IMAGE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const REPLACEMENT = new Uint8Array([9, 8, 7]);

async function cleanup() {
  if (UID) await db.delete(accounts).where(eq(accounts.uid, UID));
}

describeDb("头像的存取", () => {
  beforeEach(async () => {
    await cleanup();

    const [row] = await db
      .insert(accounts)
      .values({ username: USERNAME, nickname: "Avatar Owner" })
      .returning({ uid: accounts.uid });

    UID = row.uid;
  });

  afterAll(cleanup);

  it("新账号没有头像，账号上的标记也是空的", async () => {
    expect(await getAvatar(UID)).toBeUndefined();
    expect((await getAccount(UID))?.avatarUpdatedAt).toBeNull();
  });

  it("写入后取回一模一样的字节", async () => {
    await setAvatar(UID, IMAGE);

    const stored = await getAvatar(UID);

    expect(stored).toBeDefined();
    expect(new Uint8Array(stored!.image)).toEqual(IMAGE);
  });

  it("账号上的标记和字节行的时间戳一致，URL 里的版本号才指得准", async () => {
    const at = await setAvatar(UID, IMAGE);

    expect(at).toBeInstanceOf(Date);
    expect((await getAccount(UID))?.avatarUpdatedAt?.getTime()).toBe(
      at?.getTime(),
    );
    expect((await getAvatar(UID))?.updatedAt.getTime()).toBe(at?.getTime());
  });

  it("两列在库里精确相等，而不是靠 JS 的毫秒截断看起来相等", async () => {
    await setAvatar(UID, IMAGE);

    // 取回 JS 的 Date 会把微秒抹平，两边的差异就看不见了；这一问直接问数据库。
    const [row] = await db
      .select({
        same: sql<boolean>`${accounts.avatarUpdatedAt} = ${accountAvatars.updatedAt}`,
      })
      .from(accounts)
      .innerJoin(accountAvatars, eq(accountAvatars.uid, accounts.uid))
      .where(eq(accounts.uid, UID));

    expect(row?.same).toBe(true);
  });

  it("再传一次是替换，不是又长出一行", async () => {
    const first = await setAvatar(UID, IMAGE);
    const second = await setAvatar(UID, REPLACEMENT);

    const rows = await db
      .select()
      .from(accountAvatars)
      .where(eq(accountAvatars.uid, UID));

    expect(rows).toHaveLength(1);
    expect(new Uint8Array(rows[0].image)).toEqual(REPLACEMENT);
    expect(second!.getTime()).toBeGreaterThanOrEqual(first!.getTime());
  });

  it("换一张就换一个版本号，旧 URL 不会再命中新字节", async () => {
    const first = await setAvatar(UID, IMAGE);
    await db.execute(sql`select pg_sleep(0.01)`);
    const second = await setAvatar(UID, REPLACEMENT);

    expect(second!.getTime()).not.toBe(first!.getTime());
  });

  it("移除同时清掉字节和标记", async () => {
    await setAvatar(UID, IMAGE);

    expect(await clearAvatar(UID)).toBe(true);
    expect(await getAvatar(UID)).toBeUndefined();
    expect((await getAccount(UID))?.avatarUpdatedAt).toBeNull();
  });

  it("本来就没有头像时，移除是空操作而不是失败", async () => {
    expect(await clearAvatar(UID)).toBe(true);
    expect(await getAvatar(UID)).toBeUndefined();
  });

  it("账号不存在时两个写入都不声称成功", async () => {
    const ghost = 2_000_000_000;

    expect(await setAvatar(ghost, IMAGE)).toBeUndefined();
    expect(await clearAvatar(ghost)).toBe(false);
    expect(await getAvatar(ghost)).toBeUndefined();
  });

  it("删账号时字节跟着一起走", async () => {
    await setAvatar(UID, IMAGE);
    await db.delete(accounts).where(eq(accounts.uid, UID));

    const rows = await db
      .select()
      .from(accountAvatars)
      .where(eq(accountAvatars.uid, UID));

    expect(rows).toEqual([]);
  });
});
