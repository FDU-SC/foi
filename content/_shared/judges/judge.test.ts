import { describe, expect, it, vi } from "vitest";
import type { BackendUser, Verdict } from "@/lib/backend/types";
import {
  isInlineUnavailable,
  type InlineJudge,
  type InlineJudgement,
} from "@/lib/problems/types";
import { judgeLifeOscillator } from "./life-oscillator";
import { judgeOutputOnly } from "./output-only";
import { judgeRoulette } from "./roulette";

const USER: BackendUser = { uid: 1, groups: [] };

const CASE_COUNTS = [2, 3, 12, 14, 17];

function attempt(
  fn: InlineJudge,
  config: unknown,
  payload: unknown,
  user: BackendUser = USER,
): InlineJudgement {
  return fn({ payload, config, user, contestSlug: null });
}

function judge(
  fn: InlineJudge,
  config: unknown,
  payload: unknown,
  user: BackendUser = USER,
): Verdict {
  const judgement = attempt(fn, config, payload, user);
  if (isInlineUnavailable(judgement)) {
    throw new Error(`判题拒绝给出结果：${judgement.reason}`);
  }
  return judgement;
}

type Result = { status?: unknown; accepted?: unknown; score?: number; maxScore?: number };

function r(verdict: Verdict): Result {
  return verdict.result as Result;
}

describe("judgeOutputOnly", () => {
  const config = {
    cases: [
      { name: "场景 1", expected: "8" },
      { name: "场景 2", expected: "16" },
    ],
  };

  it("逐行比对，全对满分", () => {
    const verdict = judge(judgeOutputOnly, config, { text: "8\n16" });

    expect(r(verdict).status).toBe("accepted");
    expect(r(verdict).accepted).toBe(true);
    expect(r(verdict).score).toBe(100);
  });

  it.each(CASE_COUNTS)("%i 个场景全对时是满分的 AC", (count) => {
    const cases = Array.from({ length: count }, (_, index) => ({
      expected: String(index),
    }));

    const verdict = judge(
      judgeOutputOnly,
      { cases },
      { text: cases.map((testCase) => testCase.expected).join("\n") },
    );

    expect(r(verdict).status).toBe("accepted");
    expect(r(verdict).accepted).toBe(true);
    expect(r(verdict).score).toBe(100);
  });

  it("对一半给一半，状态是 partial", () => {
    const verdict = judge(judgeOutputOnly, config, { text: "8\n99" });

    expect(r(verdict).status).toBe("partial");
    expect(r(verdict).accepted).toBe(false);
    expect(r(verdict).score).toBe(50);
  });

  it("空白不算答案的一部分", () => {
    expect(r(judge(judgeOutputOnly, config, { text: " 8 \n 16 " })).score).toBe(100);
  });

  it("行数不够时缺的那些算错，而不是崩", () => {
    expect(r(judge(judgeOutputOnly, config, { text: "8" })).score).toBe(50);
  });

  it("配置缺 cases 时说自己判不了，而不是给一个判决", () => {
    const judgement = attempt(judgeOutputOnly, {}, { text: "8" });

    expect(isInlineUnavailable(judgement)).toBe(true);
    expect(judgement).not.toHaveProperty("score");
  });
});

describe("judgeLifeOscillator", () => {

  const BLINKER = "...\nOOO\n...";
  const config = { cases: [{ name: "场景 1", maxDim: 16, k: 2 }] };

  it("周期正好等于 k 的图案得分", () => {
    const verdict = judge(judgeLifeOscillator, config, { text: BLINKER });

    expect(r(verdict).status).toBe("accepted");
    expect(r(verdict).accepted).toBe(true);
    expect(r(verdict).score).toBe(100);
  });

  it.each(CASE_COUNTS)("%i 个场景全对时是满分的 AC", (count) => {
    const verdict = judge(
      judgeLifeOscillator,
      { cases: Array.from({ length: count }, () => ({ maxDim: 16, k: 2 })) },
      { text: Array.from({ length: count }, () => BLINKER).join("\n\n") },
    );

    expect(r(verdict).status).toBe("accepted");
    expect(r(verdict).accepted).toBe(true);
    expect(r(verdict).score).toBe(100);
  });

  it("周期不等于 k 的图案不得分", () => {
    const stillLife = "OO\nOO";
    const verdict = judge(judgeLifeOscillator, config, { text: stillLife });

    expect(r(verdict).score).toBe(0);
    expect(r(verdict).accepted).toBe(false);
  });

  it("超尺寸的图案在模拟之前就被拒", () => {
    const huge = Array.from({ length: 40 }, () => "O".repeat(40)).join("\n");
    const verdict = judge(
      judgeLifeOscillator,
      { cases: [{ name: "场景 1", maxDim: 8, k: 2 }] },
      { text: huge },
    );

    expect(r(verdict).score).toBe(0);
    const tests = (verdict.detail as { tests: { message: string }[] }).tests;
    expect(tests[0].message).toContain("超过上限");
  });

  it("非法字符按格式错误处理", () => {
    const verdict = judge(judgeLifeOscillator, config, { text: "XYZ" });
    expect(r(verdict).score).toBe(0);
  });

  it.each([
    { name: "k", cases: [{ maxDim: 16, k: 0 }] },
    { name: "k 为负", cases: [{ maxDim: 16, k: -1 }] },
    { name: "maxDim", cases: [{ maxDim: 0, k: 2 }] },
  ])("$name 非正的场景不给任何提交送分", ({ cases }) => {
    const judgement = attempt(judgeLifeOscillator, { cases }, { text: "O" });

    expect(isInlineUnavailable(judgement)).toBe(true);
    expect(judgement).not.toHaveProperty("score");
  });

  it("非法场景被丢掉，剩下的场景仍按自己的个数分满分", () => {
    const verdict = judge(
      judgeLifeOscillator,
      {
        cases: [
          { maxDim: 16, k: 2 },
          { maxDim: 16, k: 0 },
        ],
      },
      { text: BLINKER },
    );

    expect(r(verdict).status).toBe("accepted");
    expect(r(verdict).score).toBe(100);
  });
});

describe("judgeRoulette", () => {
  const config = { scoreNumber: 100, scoreColor: 30, scoreSize: 10 };

  function spin(user: BackendUser) {
    const verdict = judge(judgeRoulette, config, { text: "" }, user);
    return (verdict.detail as { number: number }).number;
  }

  it("没有 AUTH_SECRET 时说自己判不了，而不是掷出一个可推算的数", () => {
    vi.stubEnv("AUTH_SECRET", "");
    const judgement = attempt(judgeRoulette, config, { text: "red" });

    expect(isInlineUnavailable(judgement)).toBe(true);
    expect(judgement).not.toHaveProperty("score");
    vi.unstubAllEnvs();
  });

  it("不同选手同一天拿到各自的轮盘", () => {
    vi.stubEnv("AUTH_SECRET", "roulette-test-key-0123456789");

    const spins = [1, 2, 3, 4, 5, 6].map(
      (uid) => spin({ uid, groups: [] }),
    );

    expect(new Set(spins).size).toBeGreaterThan(1);
    vi.unstubAllEnvs();
  });

  it("同一个人同一天重复算是同一个结果", () => {
    vi.stubEnv("AUTH_SECRET", "roulette-test-key-0123456789");

    expect(spin(USER)).toBe(spin(USER));
    vi.unstubAllEnvs();
  });

  it("换一把密钥，结果就完全不同——说明它不是只由日期决定的", () => {
    vi.stubEnv("AUTH_SECRET", "key-one-0123456789abcdef");
    const first = [1, 2, 3, 4, 5, 6].map((uid) =>
      spin({ uid, groups: [] }),
    );

    vi.stubEnv("AUTH_SECRET", "key-two-0123456789abcdef");
    const second = [1, 2, 3, 4, 5, 6].map((uid) =>
      spin({ uid, groups: [] }),
    );

    expect(first).not.toEqual(second);
    vi.unstubAllEnvs();
  });

  it("押中数字给满分，押错给零分", () => {
    vi.stubEnv("AUTH_SECRET", "roulette-test-key-0123456789");
    const number = spin(USER);

    expect(r(judge(judgeRoulette, config, { text: String(number) })).score).toBe(100);
    expect(
      r(judge(judgeRoulette, config, { text: "not-a-bet" })).score,
    ).toBe(0);
    vi.unstubAllEnvs();
  });
});
