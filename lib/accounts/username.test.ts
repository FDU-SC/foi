import { describe, expect, it } from "vitest";
import {
  USERNAME_CHANGE_COOLDOWN_DAYS,
  usernameChangeAllowed,
  usernameChangeAvailableAt,
} from "./username";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("usernameChangeAvailableAt", () => {
  it("从未改过名就没有解禁时刻", () => {
    expect(usernameChangeAvailableAt(null)).toBeNull();
  });

  it("解禁时刻是上次改名加上冷却天数", () => {
    const changed = new Date("2026-01-01T00:00:00.000Z");

    expect(usernameChangeAvailableAt(changed)).toEqual(
      new Date(changed.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS),
    );
  });
});

describe("usernameChangeAllowed", () => {
  const changed = new Date("2026-01-01T00:00:00.000Z");
  const availableAt = new Date(
    changed.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS,
  );

  it("从未改过名一律放行", () => {
    expect(usernameChangeAllowed(null, changed)).toBe(true);
  });

  it("冷却期内拒绝", () => {
    expect(usernameChangeAllowed(changed, new Date(changed.getTime() + DAY_MS))).toBe(
      false,
    );
  });

  it("刚好到解禁时刻就放行", () => {
    expect(usernameChangeAllowed(changed, availableAt)).toBe(true);
  });

  it("解禁前一毫秒仍然拒绝", () => {
    expect(
      usernameChangeAllowed(changed, new Date(availableAt.getTime() - 1)),
    ).toBe(false);
  });
});
