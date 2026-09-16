import { describe, expect, it } from "vitest";
import { placeholderSecrets } from "./secrets";

const REAL = "9f2c1b7e4a6d8035fe1c2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70";

describe("placeholderSecrets", () => {
  it("换成真密钥后什么都不报", () => {
    expect(
      placeholderSecrets({ AUTH_SECRET: REAL, FOI_BACKEND_SECRET: REAL }),
    ).toEqual([]);
  });

  it("认出 .env.example 里的那个占位串", () => {
    const complaints = placeholderSecrets({
      AUTH_SECRET: "dev-only-not-a-real-secret-change-in-production",
      FOI_BACKEND_SECRET: REAL,
    });

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain("AUTH_SECRET");
  });

  it("会话密钥与评测密钥各报一条", () => {
    const complaints = placeholderSecrets({
      AUTH_SECRET: "change-me",
      FOI_BACKEND_SECRET: "dev-secret",
    });

    expect(complaints).toHaveLength(2);
    expect(complaints.join("\n")).toContain("AUTH_SECRET");
    expect(complaints.join("\n")).toContain("FOI_BACKEND_SECRET");
  });

  it("按形状认出后来新增的每队列密钥", () => {
    const complaints = placeholderSecrets({
      AUTH_SECRET: REAL,
      FOI_BACKEND_SECRET: REAL,
      FOI_BACKEND_LEAKY_BUCKET_SECRET: "dev-secret",
    });

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain("FOI_BACKEND_LEAKY_BUCKET_SECRET");
  });

  it("大小写与首尾空白不影响判定", () => {
    expect(
      placeholderSecrets({ AUTH_SECRET: "  Dev-Secret  " }),
    ).toHaveLength(1);
  });

  it("未设置或留空的变量不报", () => {
    expect(
      placeholderSecrets({ AUTH_SECRET: "", FOI_BACKEND_SECRET: undefined }),
    ).toEqual([]);
  });

  it("不误伤恰好包含占位串的长密钥", () => {
    expect(
      placeholderSecrets({ AUTH_SECRET: `${REAL}-dev-secret` }),
    ).toEqual([]);
  });
});
