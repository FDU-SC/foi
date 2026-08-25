import { describe, expect, it, vi } from "vitest";
import { cachedStandings, invalidateStandings, standingsKey } from "./cache";

/**
 * The cache is process-wide and deliberately so — see the note on the maps in
 * `cache.ts` — which means these cases cannot reset it between runs. Each one
 * works on a contest slug nobody else uses instead, the same way concurrent
 * requests for different contests do not interfere in production.
 */
let counter = 0;

function contest(): string {
  return `contest-${(counter += 1)}`;
}

/** A compute that finishes only when the test says so. */
function held<T>(): { compute: () => Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { compute: () => promise, settle };
}

describe("cachedStandings", () => {
  it("命中之后不再重算", async () => {
    const key = standingsKey(contest(), "public");
    const compute = vi.fn(async () => "第一版");

    expect(await cachedStandings(key, compute)).toBe("第一版");
    expect(await cachedStandings(key, compute)).toBe("第一版");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("并发的未命中合并成一次重算", async () => {
    const key = standingsKey(contest(), "public");
    const { compute, settle } = held<string>();
    const spy = vi.fn(compute);

    const both = Promise.all([
      cachedStandings(key, spy),
      cachedStandings(key, spy),
    ]);
    settle("一版");

    expect(await both).toEqual(["一版", "一版"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("失效之后下一次读会重算", async () => {
    const slug = contest();
    const key = standingsKey(slug, "public");

    await cachedStandings(key, async () => "旧的");
    invalidateStandings(slug);

    expect(await cachedStandings(key, async () => "新的")).toBe("新的");
  });

  it("一次失效清掉这场比赛的每一种榜", async () => {
    const slug = contest();
    const asPlayer = standingsKey(slug, "public");
    const asAdmin = standingsKey(slug, "unfrozen");

    await cachedStandings(asPlayer, async () => "封榜版");
    await cachedStandings(asAdmin, async () => "穿透版");
    invalidateStandings(slug);

    expect(await cachedStandings(asPlayer, async () => "新封榜版")).toBe(
      "新封榜版",
    );
    expect(await cachedStandings(asAdmin, async () => "新穿透版")).toBe(
      "新穿透版",
    );
  });
});

/**
 * The window between a recompute reading its rows and writing them down.
 *
 * A verdict landing inside it used to be lost twice over: the invalidation
 * deleted an entry that was not there yet, and then the recompute installed
 * figures taken from before the verdict and served them for a full TTL. The
 * board went stale *because* something had changed, which is the exact
 * inversion the invalidation exists to prevent.
 */
describe("重算与失效撞在一起时", () => {
  it("飞行中被失效的结果不写进缓存", async () => {
    const slug = contest();
    const key = standingsKey(slug, "public");

    const { compute, settle } = held<string>();
    const inflight = cachedStandings(key, compute);

    // The verdict lands while the recompute is still out.
    invalidateStandings(slug);
    settle("判题之前的榜");

    // Whoever was already waiting still gets it — one board a moment behind is
    // not worth a second trip to the database.
    expect(await inflight).toBe("判题之前的榜");

    // But it was not written down, so the next reader recomputes rather than
    // being served the stale figures until the TTL runs out.
    const after = vi.fn(async () => "判题之后的榜");
    expect(await cachedStandings(key, after)).toBe("判题之后的榜");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("没有失效时照常写进缓存", async () => {
    const key = standingsKey(contest(), "public");

    const { compute, settle } = held<string>();
    const inflight = cachedStandings(key, compute);
    settle("唯一的一版");
    await inflight;

    const after = vi.fn(async () => "不该被调用");
    expect(await cachedStandings(key, after)).toBe("唯一的一版");
    expect(after).not.toHaveBeenCalled();
  });

  /**
   * The counter is per key, so an invalidation for one contest must not throw
   * away a recompute another one has in the air.
   */
  it("失效只影响被失效的那场比赛", async () => {
    const mine = contest();
    const key = standingsKey(mine, "public");

    const { compute, settle } = held<string>();
    const inflight = cachedStandings(key, compute);

    invalidateStandings(contest());
    settle("这一版仍然有效");
    await inflight;

    const after = vi.fn(async () => "不该被调用");
    expect(await cachedStandings(key, after)).toBe("这一版仍然有效");
    expect(after).not.toHaveBeenCalled();
  });
});
