import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/runner/jobs/[id]/route";
import { resolveBackend } from "@/lib/backend/resolve";
import {
  MAX_CLOCK_SKEW_SECONDS,
  sign,
  signedHeaders,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  type SignedRequest,
} from "@/lib/backend/signature";
import type { Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import { externalProblem } from "@/test/content-shapes";
import { jobPath } from "./auth";

const HANDLE = "runner-route-alice";

const PROBLEM = externalProblem();
const BACKEND = PROBLEM.backend.id;

const PAYLOAD = { language: "cpp", source: "int main() { return 0; }" };

const VERDICT: Verdict = { status: "accepted", score: 100, maxScore: 100 };
const VERSION = "runner-route-fixture/1.0.0";

const MISSING = "sub_jr_no_such_row";

const SECRET = "runner-route-suite-signing-key";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

async function holding(id: string, lease: string): Promise<string> {
  await db.insert(submissions).values({
    id,
    handle: HANDLE,
    problemSlug: PROBLEM.slug,
    payload: PAYLOAD,
    backendId: BACKEND,
    state: "judging",
    lease,
    runnerId: "r-route",
    claimedAt: new Date(),
    lastHeartbeatAt: new Date(),
    attempts: 1,
  });
  return id;
}

type Credential = "valid" | "none" | "stale" | "wrong-key";

function credentials(
  kind: Credential,
  signed: SignedRequest,
): Record<string, string> {
  const secret = resolveBackend(BACKEND).secret;

  switch (kind) {

    case "none":
      return { "content-type": "application/json" };
    case "wrong-key":
      return signedHeaders(`${secret}-forged`, signed);
    case "stale": {

      const timestamp =
        Math.floor(Date.now() / 1000) - MAX_CLOCK_SKEW_SECONDS - 60;
      return {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: String(timestamp),
        [SIGNATURE_HEADER]: sign(secret, timestamp, signed),
      };
    }
    case "valid":
      return signedHeaders(secret, signed);
  }
}

function fetchJob(
  id: string,
  options: { lease?: string; credential?: Credential } = {},
): Promise<Response> {
  const search =
    options.lease === undefined
      ? ""
      : `?lease=${encodeURIComponent(options.lease)}`;
  const path = jobPath(id) + search;
  const signed = { method: "GET", path, body: "" };

  return GET(
    new Request(`http://localhost:3000${path}`, {
      method: "GET",
      headers: credentials(options.credential ?? "valid", signed),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function report(
  id: string,
  body: unknown,
  options: { credential?: Credential } = {},
): Promise<Response> {
  const path = jobPath(id);
  const text = JSON.stringify(body);
  const signed = { method: "PUT", path, body: text };

  return PUT(
    new Request(`http://localhost:3000${path}`, {
      method: "PUT",
      headers: credentials(options.credential ?? "valid", signed),
      body: text,
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function rowOf(id: string): Promise<typeof submissions.$inferSelect> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, id));
  return row;
}

async function cleanup(): Promise<void> {
  await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
}

describeDb("评测机作业接口", () => {
  beforeAll(async () => {
    vi.stubEnv("FOI_BACKEND_SECRET", SECRET);
    vi.stubEnv("FOI_PUBLIC_URL", "http://localhost:3000");

    await cleanup();
    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });

    await holding("sub_jr_mine", "lease-held-by-me");
    await holding("sub_jr_theirs", "lease-held-by-somebody-else");
  });

  afterAll(async () => {
    await cleanup();
    vi.unstubAllEnvs();
  });

  it("当前持有者取得到提交内容", async () => {
    const response = await fetchJob("sub_jr_mine", {
      lease: "lease-held-by-me",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "sub_jr_mine",
      payload: PAYLOAD,
      problem: { slug: PROBLEM.slug },
      user: { handle: HANDLE },
    });
  });

  it("拿自己的 lease 去要别人那一条，只拿到 409，内容一个字都不给", async () => {
    const response = await fetchJob("sub_jr_theirs", {
      lease: "lease-held-by-me",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("payload");
  });

  it("不带 lease 的请求同样拿不到内容", async () => {
    const response = await fetchJob("sub_jr_mine");

    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("payload");
  });

  it("没有签名连自己那一条都读不到", async () => {
    const response = await fetchJob("sub_jr_mine", {
      lease: "lease-held-by-me",
      credential: "none",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("payload");
  });

  describe("没证明持有密钥时，存在与不存在的 id 无从区分", () => {
    const unproven: Credential[] = ["none", "stale", "wrong-key"];

    it.each(unproven)("取详情：%s", async (credential) => {
      const [real, fake] = await Promise.all([
        fetchJob("sub_jr_mine", { lease: "lease-held-by-me", credential }),
        fetchJob(MISSING, { lease: "lease-held-by-me", credential }),
      ]);

      expect(real.status).toBe(401);
      expect(fake.status).toBe(real.status);
      expect(await fake.text()).toBe(await real.text());
    });

    it.each(unproven)("上报：%s", async (credential) => {
      const body = { lease: "lease-held-by-me", state: "alive" };
      const [real, fake] = await Promise.all([
        report("sub_jr_mine", body, { credential }),
        report(MISSING, body, { credential }),
      ]);

      expect(real.status).toBe(401);
      expect(fake.status).toBe(real.status);
      expect(await fake.text()).toBe(await real.text());
    });
  });

  describe("签得过时，不存在的 id 才得到 404", () => {
    it("取详情", async () => {
      const response = await fetchJob(MISSING, { lease: "anything" });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "提交不存在" });
    });

    it("上报", async () => {
      const response = await report(MISSING, {
        lease: "anything",
        state: "alive",
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "提交不存在" });
    });
  });

  describe("上报评测进展", () => {
    beforeAll(async () => {
      await holding("sub_jr_alive", "lease-alive");
      await holding("sub_jr_done", "lease-done");
      await holding("sub_jr_failed", "lease-failed");
      await holding("sub_jr_stale", "lease-current");
    });

    it("alive 记下进度，行仍然在评测中", async () => {
      const response = await report("sub_jr_alive", {
        lease: "lease-alive",
        state: "alive",
        status: "测试点 3/10",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      const row = await rowOf("sub_jr_alive");
      expect(row.state).toBe("judging");
      expect(row.runnerStatus).toBe("测试点 3/10");
      expect(row.lease).toBe("lease-alive");
    });

    it("done 落定判定，并把 lease 交回去", async () => {
      const response = await report("sub_jr_done", {
        lease: "lease-done",
        state: "done",
        verdict: VERDICT,
        backendVersion: VERSION,
      });

      expect(response.status).toBe(200);

      const row = await rowOf("sub_jr_done");
      expect(row.state).toBe("completed");
      expect(row.verdict).toEqual(VERDICT);
      expect(row.backendVersion).toBe(VERSION);
      expect(row.judgedAt).not.toBeNull();

      expect(row.lease).toBeNull();
    });

    it("failed 落 disrupted，理由原样留在行上", async () => {
      const response = await report("sub_jr_failed", {
        lease: "lease-failed",
        state: "failed",
        reason: "沙箱起不来",
        backendVersion: VERSION,
      });

      expect(response.status).toBe(200);

      const row = await rowOf("sub_jr_failed");
      expect(row.state).toBe("disrupted");
      expect(row.error).toBe("沙箱起不来");
      expect(row.verdict).toBeNull();
      expect(row.lease).toBeNull();
    });

    it("拿作废的 lease 上报，什么都写不进去", async () => {
      const response = await report("sub_jr_stale", {
        lease: "lease-that-was-revoked",
        state: "done",
        verdict: VERDICT,
        backendVersion: VERSION,
      });

      expect(response.status).toBe(409);

      const row = await rowOf("sub_jr_stale");
      expect(row.state).toBe("judging");
      expect(row.lease).toBe("lease-current");
      expect(row.verdict).toBeNull();
    });

    it("上报格式不合法时，签名对也一样被拒", async () => {
      const response = await report("sub_jr_stale", {
        lease: "lease-current",
        state: "finished",
      });

      expect(response.status).toBe(400);
    });
  });
});
