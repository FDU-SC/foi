import { describe, expect, it } from "vitest";
import { describeVerdict } from "@/lib/presentation";
import { verdicts } from "./verdicts";

describe("verdicts", () => {
  it("每一条都给出标签、缩写与色调", () => {
    for (const [status, preset] of Object.entries(verdicts)) {
      expect(preset.label, status).toBeTruthy();
      expect(preset.short, status).toBeTruthy();
      expect(preset.tone, status).toBeTruthy();
    }
  });

  it("内容解释经平台委托后显示缩写", () => {
    expect(
      describeVerdict("maze-runner", { status: "accepted" }),
    ).toMatchObject({ short: "AC", tone: "ok" });
  });
});
