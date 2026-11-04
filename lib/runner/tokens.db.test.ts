import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as CLAIM } from "@/app/api/runner/jobs/request/route";
import { backends } from "@/lib/backend/registry";
import { resolveBackend } from "@/lib/backend/resolve";
import { signedHeaders } from "@/lib/backend/signature";
import { db } from "@/lib/db";
import { runnerTokens, runners } from "@/lib/db/schema";
import { CLAIM_PATH } from "./auth";
import {
  issueRunnerToken,
  listRunnerTokens,
  parseRunnerToken,
  revokeRunnerToken,
  tokenSecret,
} from "./tokens";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const BACKEND = Object.keys(backends)[0];
const UNDECLARED = "undeclared-backend";
const RUNNER = "runner-token-suite";
const ISSUER = 424242;

let nonces = 0;

function claim(
  backendId: string,
  credential: { secret: string; keyId?: string },
): Promise<Response> {
  const body = JSON.stringify({
    backendId,
    runnerId: RUNNER,
    nonce: `token-suite-${String(++nonces).padStart(16, "0")}`,
  });

  return CLAIM(
    new Request(`http://localhost:3000${CLAIM_PATH}`, {
      method: "POST",
      headers: signedHeaders(
        credential.secret,
        { method: "POST", path: CLAIM_PATH, body },
        credential.keyId,
      ),
      body,
    }),
  );
}

async function issue(label: string) {
  const { token, row } = await issueRunnerToken({
    backendId: BACKEND,
    label,
    createdBy: ISSUER,
  });
  const parts = parseRunnerToken(token)!;
  return { token, row, keyId: parts.keyId, secret: parts.secret };
}

async function lastUsedAt(keyId: string): Promise<Date | null> {
  const [row] = await db
    .select({ lastUsedAt: runnerTokens.lastUsedAt })
    .from(runnerTokens)
    .where(eq(runnerTokens.keyId, keyId));
  return row.lastUsedAt;
}

async function cleanup(): Promise<void> {
  await db.delete(runnerTokens).where(eq(runnerTokens.createdBy, ISSUER));
  await db.delete(runners).where(eq(runners.runnerId, RUNNER));
}

describeDb("评测机令牌", () => {
  beforeAll(async () => {
    vi.stubEnv("FOI_BACKEND_SECRET", "runner-token-suite-master-key");
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    vi.unstubAllEnvs();
  });

  it("签发出的令牌带着它的队列，签名密钥由主密钥派生", async () => {
    const { token, keyId, secret, row } = await issue("宿主甲");

    expect(parseRunnerToken(token)?.backendId).toBe(BACKEND);
    expect(secret).toBe(tokenSecret(BACKEND, keyId));
    expect(row).toMatchObject({ backendId: BACKEND, label: "宿主甲", revokedAt: null });
  });

  it("持令牌签名的领取请求被接受，并记下最近使用时间", async () => {
    const { keyId, secret } = await issue("宿主乙");

    const response = await claim(BACKEND, { secret, keyId });

    expect(response.status).toBe(204);
    expect(await lastUsedAt(keyId)).not.toBeNull();
  });

  it("一分钟内重复使用不再改写最近使用时间", async () => {
    const { keyId, secret } = await issue("宿主丙");

    await claim(BACKEND, { secret, keyId });
    const first = await lastUsedAt(keyId);
    await claim(BACKEND, { secret, keyId });

    expect(await lastUsedAt(keyId)).toEqual(first);
  });

  it("吊销之后，签名再对也被拒绝", async () => {
    const { keyId, secret } = await issue("宿主丁");
    await revokeRunnerToken(keyId, ISSUER);

    const response = await claim(BACKEND, { secret, keyId });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "令牌已吊销或不存在" });
  });

  it("签名对、但表里没有这个编号的令牌被拒绝", async () => {
    const keyId = "00000000deadbeef";

    const response = await claim(BACKEND, {
      secret: tokenSecret(BACKEND, keyId)!,
      keyId,
    });

    expect(response.status).toBe(401);
  });

  it("令牌不能拿去领别的队列的任务", async () => {
    const { keyId, secret } = await issue("宿主戊");

    const response = await claim(UNDECLARED, { secret, keyId });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "签名不匹配" });
  });

  it("表里登记的队列与请求的队列不一致时同样拒绝", async () => {
    const keyId = "00000000cafebabe";
    await db.insert(runnerTokens).values({
      keyId,
      backendId: UNDECLARED,
      label: "错位的令牌",
      createdBy: ISSUER,
    });

    const response = await claim(BACKEND, {
      secret: tokenSecret(BACKEND, keyId)!,
      keyId,
    });

    expect(response.status).toBe(401);
  });

  it("格式不对的编号按签名不匹配处理，不查表", async () => {
    const response = await claim(BACKEND, {
      secret: resolveBackend(BACKEND).secret,
      keyId: "not-a-key-id",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "签名不匹配" });
  });

  it("不带编号时仍按队列密钥验签", async () => {
    const response = await claim(BACKEND, {
      secret: resolveBackend(BACKEND).secret,
    });

    expect(response.status).toBe(204);
  });

  it("队列密钥配上任意编号头也不能冒充令牌", async () => {
    const { keyId } = await issue("宿主己");

    const response = await claim(BACKEND, {
      secret: resolveBackend(BACKEND).secret,
      keyId,
    });

    expect(response.status).toBe(401);
    expect(await lastUsedAt(keyId)).toBeNull();
  });

  it("列表里有效的在前，同组内新签发的在前，并带上签发人", async () => {
    const older = await issue("较早");
    const newer = await issue("较晚");
    const gone = await issue("已吊销");
    await revokeRunnerToken(gone.keyId, ISSUER);

    const listed = (await listRunnerTokens([BACKEND])).filter((token) =>
      [older.keyId, newer.keyId, gone.keyId].includes(token.keyId),
    );

    expect(listed.map((token) => token.label)).toEqual(["较晚", "较早", "已吊销"]);
    expect(listed[2].revokedBy).toBe(ISSUER);
  });

  it("重复吊销不会改写第一次的记录", async () => {
    const { keyId } = await issue("宿主庚");

    expect(await revokeRunnerToken(keyId, ISSUER)).not.toBeNull();
    expect(await revokeRunnerToken(keyId, ISSUER + 1)).toBeNull();

    const [row] = await db
      .select()
      .from(runnerTokens)
      .where(inArray(runnerTokens.keyId, [keyId]));
    expect(row.revokedBy).toBe(ISSUER);
  });
});
