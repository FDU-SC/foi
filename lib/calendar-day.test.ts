import { describe, expect, it } from "vitest";
import { site } from "@/lib/site";
import { dayEnd, dayOf, dayStart, readDay, shiftDay, weekdayOf } from "./calendar-day";

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

  it("dayOf 按站点时区落到日期上，与 dayStart 互逆", () => {
    expect(dayOf(new Date("2026-08-31T15:59:59.999Z"))).toBe("2026-08-31");
    expect(dayOf(new Date("2026-08-31T16:00:00.000Z"))).toBe("2026-09-01");
    expect(dayOf(dayStart("2024-02-29"))).toBe("2024-02-29");
  });
});

describe("日历推算", () => {
  it("shiftDay 跨月、跨年、跨闰日", () => {
    expect(shiftDay("2026-02-28", 1)).toBe("2026-03-01");
    expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDay("2026-09-26", -364)).toBe("2025-09-27");
  });

  it("weekdayOf 从周日的 0 数到周六的 6", () => {
    expect(weekdayOf("2026-09-26")).toBe(6);
    expect(weekdayOf("2026-09-27")).toBe(0);
  });
});
