import { describe, expect, it } from "vitest";
import { site } from "@/lib/site";
import { dayEnd, dayStart, readDay } from "./calendar-day";

describe("readDay", () => {
  it("只认真实存在的 YYYY-MM-DD", () => {
    expect(readDay("2026-09-01")).toBe("2026-09-01");
    expect(readDay("2024-02-29")).toBe("2024-02-29");
    for (const value of [undefined, "", "2026-9-1", "2026-02-30", "2025-02-29", "2026-13-01", "20260901", "2026-09-01T00:00"]) {
      expect(readDay(value), String(value)).toBeUndefined();
    }
  });
});

describe("站点时区里的一天", () => {
  it("夹具站点用东八区，一天从前一天 16:00 UTC 开始", () => {
    expect(site.timezone).toBe("Asia/Shanghai");
    expect(dayStart("2026-09-01").toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(dayEnd("2026-09-01").toISOString()).toBe("2026-09-01T16:00:00.000Z");
  });

  it("月末与年末顺延到下一天", () => {
    expect(dayEnd("2026-02-28").toISOString()).toBe("2026-02-28T16:00:00.000Z");
    expect(dayEnd("2026-12-31").toISOString()).toBe("2026-12-31T16:00:00.000Z");
    expect(dayStart("2027-01-01").getTime()).toBe(dayEnd("2026-12-31").getTime());
  });
});
