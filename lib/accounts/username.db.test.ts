import { inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getAccount, updateUsername } from "./queries";

const FIRST_USERNAME = "username-update-first";
const RENAMED_USERNAME = "username-update-renamed";
const TEST_USERNAMES = [FIRST_USERNAME, RENAMED_USERNAME];

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

let firstUid = 0;

async function cleanup(): Promise<void> {
  await db.delete(accounts).where(inArray(accounts.username, TEST_USERNAMES));
}

describeDb("updateUsername", () => {
  beforeEach(async () => {
    await cleanup();
    const [first] = await db
      .insert(accounts)
      .values({ username: FIRST_USERNAME, nickname: "First" })
      .returning({ uid: accounts.uid });

    firstUid = first.uid;
  });

  afterAll(cleanup);

  it("成功修改用户名时同时记录冷却期起点", async () => {
    const result = await updateUsername(firstUid, RENAMED_USERNAME);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.account.username).toBe(RENAMED_USERNAME);
    expect(result.account.usernameChangedAt).toBeInstanceOf(Date);
    await expect(getAccount(firstUid)).resolves.toMatchObject({
      username: RENAMED_USERNAME,
      usernameChangedAt: result.account.usernameChangedAt,
    });
  });

  it("账号不存在时返回 missing 而不是伪造成功结果", async () => {
    await expect(updateUsername(2_147_483_647, RENAMED_USERNAME)).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
  });
});
