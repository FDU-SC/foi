import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTokenSecret } from "@/lib/backend/keys.cjs";
import { formatRunnerToken, parseRunnerToken, tokenSecret } from "./tokens";

const PARTS = {
  backendId: "a-backend",
  keyId: "0011223344556677",
  secret: "ab".repeat(32),
};

describe("评测机令牌的格式", () => {
  it("拼出来的令牌能原样拆回去", () => {
    const token = formatRunnerToken(PARTS);

    expect(token).toBe(`foir_a-backend_0011223344556677_${"ab".repeat(32)}`);
    expect(parseRunnerToken(token)).toEqual(PARTS);
  });

  it("容忍从 .env 里抄来时带上的首尾空白", () => {
    expect(parseRunnerToken(`  ${formatRunnerToken(PARTS)}\n`)).toEqual(PARTS);
  });

  it.each([
    ["前缀不对", `foix_a-backend_0011223344556677_${"ab".repeat(32)}`],
    ["后端 id 不是 slug", `foir_A-Backend_0011223344556677_${"ab".repeat(32)}`],
    ["编号太短", `foir_a-backend_00112233_${"ab".repeat(32)}`],
    ["密钥不是 64 位十六进制", "foir_a-backend_0011223344556677_abcd"],
    ["多出一段", `foir_a-backend_0011223344556677_${"ab".repeat(32)}_x`],
    ["空串", ""],
  ])("%s 时拆不出来", (_case, token) => {
    expect(parseRunnerToken(token)).toBeNull();
  });
});

describe("令牌的签名密钥", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("由主密钥、后端与编号派生", () => {
    vi.stubEnv("FOI_BACKEND_SECRET", "token-test-master");

    expect(tokenSecret(PARTS.backendId, PARTS.keyId)).toBe(
      deriveTokenSecret("token-test-master", PARTS.backendId, PARTS.keyId),
    );
  });

  it("没有主密钥时派生不出来", () => {
    vi.stubEnv("FOI_BACKEND_SECRET", "");

    expect(tokenSecret(PARTS.backendId, PARTS.keyId)).toBeUndefined();
  });
});
