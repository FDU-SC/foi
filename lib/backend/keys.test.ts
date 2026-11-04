import { describe, expect, it } from "vitest";
import { deriveBackendSecret, deriveTokenSecret } from "./keys.cjs";

// Every runner carries its own copy of the derivation. These values are the
// contract: a copy that disagrees on any of them answers every request with 401.
const MASTER = "0123456789abcdef0123456789abcdef";
const BACKEND = "a-backend";
const OTHER = "another-backend";
const KEY_ID = "0011223344556677";

describe("队列密钥派生", () => {
  it("与固定样例逐字一致", () => {
    expect(deriveBackendSecret(MASTER, BACKEND)).toBe(
      "d067cfb430e1895519d3c046a39d1a9ab94bb716c89017197dc1c3f7a32c43bb",
    );
    expect(deriveBackendSecret(MASTER, OTHER)).toBe(
      "594c2acdff5ed25294f94af373d4fe160718a09e68aa9ebe5bcfb94c0b00793b",
    );
  });

  it("换一把主密钥，派生结果跟着变", () => {
    expect(deriveBackendSecret(`${MASTER}x`, BACKEND)).not.toBe(
      deriveBackendSecret(MASTER, BACKEND),
    );
  });
});

describe("令牌密钥派生", () => {
  it("与固定样例逐字一致", () => {
    expect(deriveTokenSecret(MASTER, BACKEND, KEY_ID)).toBe(
      "02d1ddf136a0e205751c8a514c427da377984ee433fb875f320501a07659c7f9",
    );
    expect(deriveTokenSecret(MASTER, OTHER, KEY_ID)).toBe(
      "1b584588b6b268b17650308e8d264385866e6b9f4894a9df9702bb773628b826",
    );
  });

  it("与同名队列的密钥分属不同的域", () => {
    expect(deriveTokenSecret(MASTER, BACKEND, KEY_ID)).not.toBe(
      deriveBackendSecret(MASTER, BACKEND),
    );
  });
});
