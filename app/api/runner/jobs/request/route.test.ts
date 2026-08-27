import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backends } from "@/lib/backend/registry";
import { resolveBackend } from "@/lib/backend/resolve";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  sign,
} from "@/lib/backend/signature";
import { CLAIM_PATH } from "@/lib/runner/auth";
import { claimNonces } from "@/lib/runner/replay";

const queue = vi.hoisted(() => ({ claimJob: vi.fn() }));

vi.mock("@/lib/runner/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runner/queue")>()),
  claimJob: queue.claimJob,
}));

const { POST } = await import("./route");

const BACKEND_ID = Object.keys(backends)[0];

let nonces = 0;

function freshNonce(): string {
  return `nonce-${String(++nonces).padStart(16, "0")}`;
}

function claim(
  body: Record<string, unknown>,
  options: { sign: boolean } = { sign: true },
): Promise<Response> {
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.sign) {
    headers[TIMESTAMP_HEADER] = String(timestamp);
    headers[SIGNATURE_HEADER] = sign(
      resolveBackend(BACKEND_ID).secret,
      timestamp,
      { method: "POST", path: CLAIM_PATH, body: payload },
    );
  }

  return POST(
    new Request(`http://localhost:3000${CLAIM_PATH}`, {
      method: "POST",
      headers,
      body: payload,
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("FOI_BACKEND_SECRET", "claim-test-secret");
  queue.claimJob.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  queue.claimJob.mockReset();
});

describe("领活接口的 nonce", () => {
  it("带上新 nonce 的合法请求照常领活", async () => {
    const response = await claim({
      backendId: BACKEND_ID,
      runnerId: "runner-a",
      nonce: freshNonce(),
    });

    expect(response.status).toBe(204);
    expect(queue.claimJob).toHaveBeenCalledTimes(1);
  });

  it("同一个 nonce 再来一次就是 401，而且不碰队列", async () => {
    const nonce = freshNonce();
    const body = { backendId: BACKEND_ID, runnerId: "runner-a", nonce };

    await claim(body);
    queue.claimJob.mockClear();

    const replayed = await claim(body);

    expect(replayed.status).toBe(401);
    expect(queue.claimJob).not.toHaveBeenCalled();
  });

  it("不带 nonce 的请求是 400，协议里它不是可选的", async () => {
    const response = await claim({
      backendId: BACKEND_ID,
      runnerId: "runner-a",
    });

    expect(response.status).toBe(400);
    expect(queue.claimJob).not.toHaveBeenCalled();
  });

  it("太短的 nonce 也是 400——它得真的带上熵", async () => {
    const response = await claim({
      backendId: BACKEND_ID,
      runnerId: "runner-a",
      nonce: "short",
    });

    expect(response.status).toBe(400);
  });

  it("验签失败的请求不会消耗 nonce", async () => {
    const nonce = freshNonce();

    const refused = await claim(
      { backendId: BACKEND_ID, runnerId: "runner-a", nonce },
      { sign: false },
    );

    expect(refused.status).toBe(401);
    expect(queue.claimJob).not.toHaveBeenCalled();
    expect(claimNonces.firstUse(BACKEND_ID, nonce)).toBe(true);
  });

  it("未签名的请求，对已用和未用的 nonce 给出同样的回答", async () => {
    const spent = freshNonce();
    await claim({ backendId: BACKEND_ID, runnerId: "runner-a", nonce: spent });

    const unsigned = { backendId: BACKEND_ID, runnerId: "runner-a" };
    const onSpent = await claim({ ...unsigned, nonce: spent }, { sign: false });
    const onFresh = await claim(
      { ...unsigned, nonce: freshNonce() },
      { sign: false },
    );

    expect(onSpent.status).toBe(onFresh.status);
    expect(await onSpent.text()).toBe(await onFresh.text());
  });
});
