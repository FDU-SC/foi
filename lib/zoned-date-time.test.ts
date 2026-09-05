import { describe, expect, it } from "vitest";
import { zonedDateTime } from "./zoned-date-time";

describe("zonedDateTime", () => {
  it("接受 Z、显式时区偏移和可选的小数秒", () => {
    for (const value of [
      "2026-01-15T05:00Z",
      "2026-01-15T13:00:00+08:00",
      "2026-01-15T05:00:00.123Z",
    ]) {
      expect(zonedDateTime.safeParse(value).success, value).toBe(true);
    }
  });

  it("把不同时区写法转换成同一个时刻", () => {
    const utc = zonedDateTime.parse("2026-01-15T05:00:00Z");
    const shanghai = zonedDateTime.parse("2026-01-15T13:00:00+08:00");

    expect(shanghai).toEqual(utc);
  });

  it("拒绝没有时区的日期和本地时间", () => {
    for (const value of ["2026-01-15", "2026-01-15T13:00:00"]) {
      expect(zonedDateTime.safeParse(value).success, value).toBe(false);
    }
  });

  it("拒绝超出范围的日期、时间和时区偏移", () => {
    for (const value of [
      "2026-13-15T13:00:00Z",
      "2026-01-15T25:00:00Z",
      "2026-01-15T13:00:00+24:00",
    ]) {
      expect(zonedDateTime.safeParse(value).success, value).toBe(false);
    }
  });

  it("拒绝非 ISO 8601 分隔符和不完整的偏移", () => {
    for (const value of [
      "2026-01-15 13:00:00Z",
      "2026-01-15T13:00:00+08",
      "2026/01/15T13:00:00+08:00",
    ]) {
      expect(zonedDateTime.safeParse(value).success, value).toBe(false);
    }
  });
});
