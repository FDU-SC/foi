import { describe, expect, it } from "vitest";
import {
  centered,
  clampOffset,
  coverScale,
  cropOf,
  scaleFor,
  zoomAround,
  ZOOM,
  type CropState,
  type Size,
} from "./crop";

const FRAME = 288;

const WIDE: Size = { width: 1600, height: 900 };
const TALL: Size = { width: 900, height: 1600 };
const SQUARE: Size = { width: 1000, height: 1000 };

/** The frame is covered when no edge of the picture has drifted inside it. */
function covers(source: Size, state: CropState): boolean {
  const scale = scaleFor(source, FRAME, state.zoom);
  const slack = 1e-9;

  return (
    state.x <= slack &&
    state.y <= slack &&
    state.x + source.width * scale >= FRAME - slack &&
    state.y + source.height * scale >= FRAME - slack
  );
}

/** The crop must name a square that actually exists inside the source. */
function inside(source: Size, state: CropState): boolean {
  const crop = cropOf(source, FRAME, state);
  const slack = 1e-9;

  return (
    crop.x >= -slack &&
    crop.y >= -slack &&
    crop.x + crop.size <= source.width + slack &&
    crop.y + crop.size <= source.height + slack
  );
}

describe("coverScale", () => {
  it("按短边铺满，宽图用高度定，长图用宽度定", () => {
    expect(coverScale(WIDE, FRAME)).toBeCloseTo(FRAME / 900);
    expect(coverScale(TALL, FRAME)).toBeCloseTo(FRAME / 900);
  });

  it("比画框还小的图会被放大到铺满", () => {
    expect(coverScale({ width: 64, height: 64 }, FRAME)).toBeCloseTo(FRAME / 64);
  });
});

describe("centered", () => {
  it("最小缩放下画框正好被盖住", () => {
    for (const source of [WIDE, TALL, SQUARE]) {
      expect(covers(source, centered(source, FRAME))).toBe(true);
    }
  });

  it("宽图只在水平方向留有余量", () => {
    const state = centered(WIDE, FRAME);

    expect(state.x).toBeLessThan(0);
    expect(state.y).toBeCloseTo(0);
  });

  it("正方形的图在最小缩放下严丝合缝", () => {
    const state = centered(SQUARE, FRAME);

    expect(state.x).toBeCloseTo(0);
    expect(state.y).toBeCloseTo(0);
  });

  it("取的正是整张图的中心", () => {
    const crop = cropOf(WIDE, FRAME, centered(WIDE, FRAME));

    expect(crop.size).toBeCloseTo(900);
    expect(crop.x).toBeCloseTo((1600 - 900) / 2);
    expect(crop.y).toBeCloseTo(0);
  });
});

describe("clampOffset", () => {
  it("拖得再远也不会把画框拖出图外", () => {
    for (const source of [WIDE, TALL, SQUARE]) {
      for (const [x, y] of [
        [9999, 9999],
        [-9999, -9999],
        [9999, -9999],
        [0, 0],
      ]) {
        const state = clampOffset(source, FRAME, { zoom: 1.7, x, y });

        expect(covers(source, state), `${source.width}x${source.height}`).toBe(true);
        expect(inside(source, state)).toBe(true);
      }
    }
  });

  it("范围内的位置原样保留", () => {
    const state = clampOffset(WIDE, FRAME, { zoom: 1, x: -100, y: 0 });

    expect(state.x).toBe(-100);
    expect(state.y).toBe(0);
  });

  it("缩放不被这一步改动", () => {
    expect(clampOffset(WIDE, FRAME, { zoom: 2.5, x: 0, y: 0 }).zoom).toBe(2.5);
  });
});

describe("zoomAround", () => {
  it("画框中心对着的那一点在缩放前后不动", () => {
    const start = clampOffset(WIDE, FRAME, { zoom: 1.4, x: -300, y: -60 });
    const before = cropOf(WIDE, FRAME, start);

    const after = cropOf(WIDE, FRAME, zoomAround(WIDE, FRAME, start, 2.2));

    expect(after.x + after.size / 2).toBeCloseTo(before.x + before.size / 2, 6);
    expect(after.y + after.size / 2).toBeCloseTo(before.y + before.size / 2, 6);
  });

  it("放大取到的范围更小，缩小取到的更大", () => {
    const start = centered(SQUARE, FRAME, 2);

    expect(cropOf(SQUARE, FRAME, zoomAround(SQUARE, FRAME, start, 3)).size).toBeLessThan(
      cropOf(SQUARE, FRAME, start).size,
    );
    expect(
      cropOf(SQUARE, FRAME, zoomAround(SQUARE, FRAME, start, 1.2)).size,
    ).toBeGreaterThan(cropOf(SQUARE, FRAME, start).size);
  });

  it("缩放被夹在区间内，越界的输入不会漏出去", () => {
    const start = centered(WIDE, FRAME);

    expect(zoomAround(WIDE, FRAME, start, 99).zoom).toBe(ZOOM.max);
    expect(zoomAround(WIDE, FRAME, start, 0).zoom).toBe(ZOOM.min);
    expect(zoomAround(WIDE, FRAME, start, -5).zoom).toBe(ZOOM.min);
  });

  it("从边角缩回去时会重新贴边，不会露出空白", () => {
    const corner = clampOffset(WIDE, FRAME, { zoom: 3.5, x: -9999, y: -9999 });
    const out = zoomAround(WIDE, FRAME, corner, ZOOM.min);

    expect(covers(WIDE, out)).toBe(true);
    expect(inside(WIDE, out)).toBe(true);
  });
});

describe("cropOf", () => {
  it("最小缩放下取的是完整的短边", () => {
    expect(cropOf(TALL, FRAME, centered(TALL, FRAME)).size).toBeCloseTo(900);
  });

  it("放大两倍就只取一半边长", () => {
    const state = centered(SQUARE, FRAME, 2);

    expect(cropOf(SQUARE, FRAME, state).size).toBeCloseTo(500);
  });

  it("任何合法状态取出的方框都落在原图之内", () => {
    for (const source of [WIDE, TALL, SQUARE, { width: 64, height: 4000 }]) {
      for (const zoom of [1, 1.3, 2, 3.7, ZOOM.max]) {
        for (const [x, y] of [
          [0, 0],
          [-1e6, -1e6],
          [1e6, 1e6],
        ]) {
          const state = clampOffset(source, FRAME, { zoom, x, y });

          expect(inside(source, state), `${source.width}x${source.height}@${zoom}`).toBe(
            true,
          );
        }
      }
    }
  });
});
