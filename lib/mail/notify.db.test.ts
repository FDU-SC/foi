import { describe, expect, it, vi } from "vitest";
import { verifyToken } from "@/lib/tokens/stateless";
import type { MailMessage } from "./transport";
import { sendPasswordReset, sendVerificationLink } from "./notify";

const relay = vi.hoisted(() => ({
  sent: [] as MailMessage[],
}));

vi.mock("./transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transport")>();
  return {
    ...actual,
    deliver: async (message: MailMessage) => {
      relay.sent.push(message);
    },
  };
});

function tokenFromLastMail(): string {
  const last = relay.sent.at(-1);
  if (!last) throw new Error("没有邮件发出");

  const url = last.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error("邮件正文里没有链接");

  const token = new URL(url).searchParams.get("token");
  if (!token) throw new Error("链接上没有 token");
  return token;
}

describe("sendVerificationLink", () => {
  it("发出的链接包含可验证的 email-verify token", async () => {
    vi.stubEnv("FOI_PUBLIC_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-notify");
    relay.sent = [];

    await sendVerificationLink("user@example.test");

    expect(relay.sent).toHaveLength(1);
    expect(relay.sent[0].to).toBe("user@example.test");

    const token = tokenFromLastMail();
    const payload = verifyToken(token, "email-verify");
    expect(payload).not.toBeNull();
    expect(payload!.s).toBe("user@example.test");

    vi.unstubAllEnvs();
  });
});

describe("sendPasswordReset", () => {
  it("发出的链接包含可验证的 password-reset token with fingerprint", async () => {
    vi.stubEnv("FOI_PUBLIC_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-notify");
    relay.sent = [];

    await sendPasswordReset(
      { handle: "alice", displayName: "Alice", email: "alice@example.test" },
      "fp_abc123",
    );

    expect(relay.sent).toHaveLength(1);
    expect(relay.sent[0].to).toBe("alice@example.test");

    const token = tokenFromLastMail();
    const payload = verifyToken(token, "password-reset");
    expect(payload).not.toBeNull();
    expect(payload!.s).toBe("alice");
    expect(payload!.fp).toBe("fp_abc123");

    vi.unstubAllEnvs();
  });
});
