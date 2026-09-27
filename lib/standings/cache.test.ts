import { describe, expect, it, vi } from "vitest";
import {
  cachedStandings,
  invalidateStandings,
  MAX_CACHED_BOARDS,
  standingsKey,
} from "./cache";

let counter = 0;

function contest(): string {
  return `contest-${(counter += 1)}`;
}

function held<T>(): { compute: () => Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { compute: () => promise, settle };
}

describe("cachedStandings", () => {
  it("命中之后不再重算", async () => {
    const slug = contest();
    const key = standingsKey(slug, "public");
    const compute = vi.fn(async () => "第一版");

    expect(await cachedStandings(key, [slug], compute)).toBe("第一版");
    expect(await cachedStandings(key, [slug], compute)).toBe("第一版");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("并发的未命中合并成一次重算", async () => {
    const slug = contest();
    const key = standingsKey(slug, "public");
    const { compute, settle } = held<string>();
    const spy = vi.fn(compute);

    const both = Promise.all([
      cachedStandings(key, [slug], spy),
      cachedStandings(key, [slug], spy),
    ]);
    settle("一版");

    expect(await both).toEqual(["一版", "一版"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("失效之后下一次读会重算", async () => {
    const slug = contest();
    const key = standingsKey(slug, "public");

    await cachedStandings(key, [slug], async () => "旧的");
    invalidateStandings(slug);

    expect(await cachedStandings(key, [slug], async () => "新的")).toBe("新的");
  });

  it("一次失效清掉这场比赛的每一种榜", async () => {
    const slug = contest();
    const asPlayer = standingsKey(slug, "public");
    const asAdmin = standingsKey(slug, "unfrozen");

    await cachedStandings(asPlayer, [slug], async () => "封榜版");
    await cachedStandings(asAdmin, [slug], async () => "穿透版");
    invalidateStandings(slug);

    expect(await cachedStandings(asPlayer, [slug], async () => "新封榜版")).toBe(
      "新封榜版",
    );
    expect(await cachedStandings(asAdmin, [slug], async () => "新穿透版")).toBe(
      "新穿透版",
    );
  });

  it("跨比赛的榜在其中任一场失效时重算，其余比赛的失效不影响它", async () => {
    const [first, second, unrelated] = [contest(), contest(), contest()];
    const key = standingsKey("board", `${first},${second}`);

    await cachedStandings(key, [first, second], async () => "合并榜");
    invalidateStandings(unrelated);
    expect(await cachedStandings(key, [first, second], async () => "不该被调用")).toBe("合并榜");

    invalidateStandings(second);
    expect(await cachedStandings(key, [first, second], async () => "新合并榜")).toBe("新合并榜");
  });
});

describe("重算与失效撞在一起时", () => {
  it("飞行中被失效的结果不写进缓存", async () => {
    const slug = contest();
    const key = standingsKey(slug, "public");

    const { compute, settle } = held<string>();
    const inflight = cachedStandings(key, [slug], compute);

    invalidateStandings(slug);
    settle("判题之前的榜");

    expect(await inflight).toBe("判题之前的榜");

    const after = vi.fn(async () => "判题之后的榜");
    expect(await cachedStandings(key, [slug], after)).toBe("判题之后的榜");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("没有失效时照常写进缓存", async () => {
    const slug = contest();
    const key = standingsKey(slug, "public");

    const { compute, settle } = held<string>();
    const inflight = cachedStandings(key, [slug], compute);
    settle("唯一的一版");
    await inflight;

    const after = vi.fn(async () => "不该被调用");
    expect(await cachedStandings(key, [slug], after)).toBe("唯一的一版");
    expect(after).not.toHaveBeenCalled();
  });

  it("失效只影响被失效的那场比赛", async () => {
    const mine = contest();
    const key = standingsKey(mine, "public");

    const { compute, settle } = held<string>();
    const inflight = cachedStandings(key, [mine], compute);

    invalidateStandings(contest());
    settle("这一版仍然有效");
    await inflight;

    const after = vi.fn(async () => "不该被调用");
    expect(await cachedStandings(key, [mine], after)).toBe("这一版仍然有效");
    expect(after).not.toHaveBeenCalled();
  });
});

describe("缓存容量", () => {
  it("写入新榜时移出已过期的榜，不等它所在的比赛失效", async () => {
    const slug = contest();
    const stale = standingsKey(slug, "2026-01-01..2026-01-02");
    await cachedStandings(stale, [slug], async () => "过期的榜", 0);

    await cachedStandings(standingsKey(slug, "2026-01-01..2026-01-03"), [slug], async () => "新榜");

    expect(globalThis.__foiStandingsCache?.has(stale)).toBe(false);
    expect(globalThis.__foiStandingsTags?.has(stale)).toBe(false);
  });

  it("查询出的榜再多，也只留最近的上限张", async () => {
    const slug = contest();
    const keys = Array.from({ length: MAX_CACHED_BOARDS + 1 }, (_, day) =>
      standingsKey(slug, `until-${day}`));
    for (const key of keys) await cachedStandings(key, [slug], async () => key);

    expect(globalThis.__foiStandingsCache?.size).toBeLessThanOrEqual(MAX_CACHED_BOARDS);

    const newest = vi.fn(async () => "不该被调用");
    expect(await cachedStandings(keys.at(-1)!, [slug], newest)).toBe(keys.at(-1));
    expect(newest).not.toHaveBeenCalled();

    const oldest = vi.fn(async () => "重算");
    expect(await cachedStandings(keys[0], [slug], oldest)).toBe("重算");
    expect(oldest).toHaveBeenCalledTimes(1);
  });

  it("过期条目被移出时，它正在进行的重算仍能被失效", async () => {
    const slug = contest();
    const key = standingsKey(slug, "public");
    await cachedStandings(key, [slug], async () => "过期的榜", 0);

    const { compute, settle } = held<string>();
    const inflight = cachedStandings(key, [slug], compute);
    const other = contest();
    await cachedStandings(standingsKey(other, "public"), [other], async () => "别的榜");

    invalidateStandings(slug);
    settle("判题之前的榜");
    expect(await inflight).toBe("判题之前的榜");

    const after = vi.fn(async () => "判题之后的榜");
    expect(await cachedStandings(key, [slug], after)).toBe("判题之后的榜");
    expect(after).toHaveBeenCalledTimes(1);
  });
});
