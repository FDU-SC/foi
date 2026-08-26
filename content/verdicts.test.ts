import { describe, expect, it } from "vitest";
import { describeVerdict } from "@/lib/presentation";
import { verdicts } from "./verdicts";

/**
 * This deployment's verdict vocabulary, and that the kernel actually reads it.
 *
 * The second half is what makes the file worth having: `describeVerdict` finds
 * this table through `content-presentation-modules.ts`, so a table that exists
 * but is never wired into `content/components/index.tsx` would leave every
 * status rendering as its raw string with nothing failing.
 */
describe("verdicts", () => {
  it("每一条都给出标签、缩写与色调", () => {
    for (const [status, preset] of Object.entries(verdicts)) {
      expect(preset.label, status).toBeTruthy();
      expect(preset.short, status).toBeTruthy();
      expect(preset.tone, status).toBeTruthy();
    }
  });

  it("登记过的 status 经内核翻译成缩写", () => {
    expect(
      describeVerdict({
        outcome: "accepted",
        score: null,
        maxScore: null,
        accepted: null,
      }),
    ).toMatchObject({ short: "AC", tone: "ok" });
  });
});
