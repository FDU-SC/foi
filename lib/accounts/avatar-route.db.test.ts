import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/avatars/[uid]/route";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { setAvatar } from "./queries";

const USERNAME = "avatar-route-owner";
const BARE_USERNAME = "avatar-route-bare";

let UID = 0;
let BARE_UID = 0;
let VERSION = 0;

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
  console.warn("[test] 数据库不可达，跳过头像端点用例");
}

const IMAGE = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xff, 0x00, 0x2a]);

function get(uid: number | string, query = "", headers?: HeadersInit) {
  return GET(new Request(`http://localhost:3000/api/avatars/${uid}${query}`, { headers }), {
    params: Promise.resolve({ uid: String(uid) }),
  });
}

async function cleanup() {
  for (const uid of [UID, BARE_UID]) {
    if (uid) await db.delete(accounts).where(eq(accounts.uid, uid));
  }
}

describeDb("头像端点", () => {
  beforeAll(async () => {
    await cleanup();

    const [owner] = await db
      .insert(accounts)
      .values({ username: USERNAME, nickname: "Route Owner" })
      .returning({ uid: accounts.uid });
    UID = owner.uid;

    const [bare] = await db
      .insert(accounts)
      .values({ username: BARE_USERNAME, nickname: "No Avatar" })
      .returning({ uid: accounts.uid });
    BARE_UID = bare.uid;

    VERSION = (await setAvatar(UID, IMAGE))!.getTime();
  });

  afterAll(cleanup);

  it("取回原样的字节，并声明成 WebP", async () => {
    const response = await get(UID, `?v=${VERSION}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(IMAGE);
  });

  it("URL 报出了正确版本号，才给出一年不变的承诺", async () => {
    const response = await get(UID, `?v=${VERSION}`);

    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("没带版本号的链接每次都要回源问一遍", async () => {
    const response = await get(UID);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).not.toContain("immutable");
    expect(response.headers.get("cache-control")).toContain("must-revalidate");
  });

  it("版本号对不上的旧链接同样不敢固化", async () => {
    const response = await get(UID, `?v=${VERSION - 1000}`);

    expect(response.headers.get("cache-control")).not.toContain("immutable");
  });

  it("ETag 命中就只回 304，不再吐字节", async () => {
    const first = await get(UID, `?v=${VERSION}`);
    const etag = first.headers.get("etag");

    expect(etag).toBeTruthy();

    const second = await get(UID, `?v=${VERSION}`, { "if-none-match": etag! });

    expect(second.status).toBe(304);
    expect((await second.arrayBuffer()).byteLength).toBe(0);
  });

  it("没设过头像的账号是 404，不是一张空图", async () => {
    const response = await get(BARE_UID);

    expect(response.status).toBe(404);
  });

  it("不存在的账号是 404", async () => {
    const response = await get(2_000_000_000);

    expect(response.status).toBe(404);
  });

  it("uid 不是正整数时不去查库", async () => {
    for (const bad of ["abc", "-1", "0", "1.5", "1e999"]) {
      expect((await get(bad)).status, bad).toBe(404);
    }
  });
});
