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

/**
 * The judges that run in the kernel rather than on a backend.
 *
 * Worth their own coverage precisely because there is no service between them
 * and a submission: a backend that misbehaves is reported as unhealthy, while
 * one of these misbehaving is the platform itself getting an answer wrong.
 */
const USER: BackendUser = { handle: "alice", groups: [] };

/**
 * Case counts the all-correct assertions run at: two that divide 100 cleanly
 * enough to hide the old bug, three that do not.
 */
const CASE_COUNTS = [2, 3, 12, 14, 17];

/** Whatever the judge said, verdict or refusal. */
function attempt(
  fn: InlineJudge,
  config: unknown,
  payload: unknown,
  user: BackendUser = USER,
): InlineJudgement {
  return fn({ payload, config, user, contestSlug: null });
}

/**
 * The same call, insisting a verdict came back.
 *
 * Every assertion below except the two about unavailability is about what a
 * judgement *says*, and reading `.score` off a union whose other half is "I
 * cannot judge this" would either not compile or quietly compare `undefined`.
 * Failing here names which judge declined and why.
 */
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

describe("judgeOutputOnly", () => {
  const config = {
    cases: [
      { name: "场景 1", expected: "8" },
      { name: "场景 2", expected: "16" },
    ],
  };

  it("逐行比对，全对满分", () => {
    const verdict = judge(judgeOutputOnly, config, { text: "8\n16" });

    expect(verdict.status).toBe("accepted");
    expect(verdict.accepted).toBe(true);
    expect(verdict.score).toBe(100);
  });

  /**
   * Parameterised on the number of cases, because that is the only thing that
   * decides whether the old summing was wrong. `100 / n` added back up n times
   * is exactly 100 for 2 and 3 and short of it for 12, 14 and 17 —
   * 99.99999999999999, and 99.99999999999997 at 17 — so an entirely correct
   * submission failed to reach full marks and settled as `partial`.
   *
   * Every problem shipped today has two or three scenes. A test written
   * against the live configuration passes either way, which is exactly how
   * this survived.
   */
  it.each(CASE_COUNTS)("%i 个场景全对时是满分的 AC", (count) => {
    const cases = Array.from({ length: count }, (_, index) => ({
      expected: String(index),
    }));

    const verdict = judge(
      judgeOutputOnly,
      { cases },
      { text: cases.map((testCase) => testCase.expected).join("\n") },
    );

    expect(verdict.status).toBe("accepted");
    expect(verdict.accepted).toBe(true);
    expect(verdict.score).toBe(100);
  });

  it("对一半给一半，状态是 partial", () => {
    const verdict = judge(judgeOutputOnly, config, { text: "8\n99" });

    expect(verdict.status).toBe("partial");
    expect(verdict.accepted).toBe(false);
    expect(verdict.score).toBe(50);
  });

  it("空白不算答案的一部分", () => {
    expect(judge(judgeOutputOnly, config, { text: " 8 \n 16 " }).score).toBe(100);
  });

  it("行数不够时缺的那些算错，而不是崩", () => {
    expect(judge(judgeOutputOnly, config, { text: "8" }).score).toBe(50);
  });

  /**
   * A setter's mistake, not a competitor's — so it must not read as a wrong
   * answer, and must not cost anybody a score. The second half of that only
   * became true when this stopped being a `system_error` verdict: any verdict
   * settles the row as `completed`, which is on the board and, under ACM
   * rules, a penalised attempt.
   */
  it("配置缺 cases 时说自己判不了，而不是给一个判决", () => {
    const judgement = attempt(judgeOutputOnly, {}, { text: "8" });

    expect(isInlineUnavailable(judgement)).toBe(true);
    expect(judgement).not.toHaveProperty("score");
  });
});

describe("judgeLifeOscillator", () => {
  /** A blinker: period 2. */
  const BLINKER = "...\nOOO\n...";
  const config = { cases: [{ name: "场景 1", maxDim: 16, k: 2 }] };

  it("周期正好等于 k 的图案得分", () => {
    const verdict = judge(judgeLifeOscillator, config, { text: BLINKER });

    expect(verdict.status).toBe("accepted");
    expect(verdict.accepted).toBe(true);
    expect(verdict.score).toBe(100);
  });

  /** Same floating-point trap as `judgeOutputOnly`; the note is over there. */
  it.each(CASE_COUNTS)("%i 个场景全对时是满分的 AC", (count) => {
    const verdict = judge(
      judgeLifeOscillator,
      { cases: Array.from({ length: count }, () => ({ maxDim: 16, k: 2 })) },
      { text: Array.from({ length: count }, () => BLINKER).join("\n\n") },
    );

    expect(verdict.status).toBe("accepted");
    expect(verdict.accepted).toBe(true);
    expect(verdict.score).toBe(100);
  });

  it("周期不等于 k 的图案不得分", () => {
    const stillLife = "OO\nOO"; // period 1, not 2
    const verdict = judge(judgeLifeOscillator, config, { text: stillLife });

    expect(verdict.score).toBe(0);
    expect(verdict.accepted).toBe(false);
  });

  /**
   * The size check is what bounds the simulation, so it has to run before it —
   * this is the only thing keeping an inline judge's cost tied to the setter's
   * configuration rather than to whatever the submitter pasted.
   */
  it("超尺寸的图案在模拟之前就被拒", () => {
    const huge = Array.from({ length: 40 }, () => "O".repeat(40)).join("\n");
    const verdict = judge(
      judgeLifeOscillator,
      { cases: [{ name: "场景 1", maxDim: 8, k: 2 }] },
      { text: huge },
    );

    expect(verdict.score).toBe(0);
    const tests = (verdict.detail as { tests: { message: string }[] }).tests;
    expect(tests[0].message).toContain("超过上限");
  });

  it("非法字符按格式错误处理", () => {
    const verdict = judge(judgeLifeOscillator, config, { text: "XYZ" });
    expect(verdict.score).toBe(0);
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

  /**
   * Per player, not per day for everybody. The verdict reveals the number, so
   * a shared wheel meant the first person to submit could hand that day's
   * answer to everyone else.
   */
  it("不同选手同一天拿到各自的轮盘", () => {
    vi.stubEnv("AUTH_SECRET", "roulette-test-key-0123456789");

    const spins = ["alice", "bob", "carol", "dave", "erin", "frank"].map(
      (handle) => spin({ handle, groups: [] }),
    );

    expect(new Set(spins).size).toBeGreaterThan(1);
    vi.unstubAllEnvs();
  });

  it("同一个人同一天重复算是同一个结果", () => {
    vi.stubEnv("AUTH_SECRET", "roulette-test-key-0123456789");

    expect(spin(USER)).toBe(spin(USER));
    vi.unstubAllEnvs();
  });

  /**
   * The reason the key exists. The old implementation hashed only the date, so
   * anyone who could guess that one line could compute a month of results —
   * while the statement claimed nobody could know them in advance.
   */
  it("换一把密钥，结果就完全不同——说明它不是只由日期决定的", () => {
    vi.stubEnv("AUTH_SECRET", "key-one-0123456789abcdef");
    const first = ["a", "b", "c", "d", "e", "f"].map((h) =>
      spin({ handle: h, groups: [] }),
    );

    vi.stubEnv("AUTH_SECRET", "key-two-0123456789abcdef");
    const second = ["a", "b", "c", "d", "e", "f"].map((h) =>
      spin({ handle: h, groups: [] }),
    );

    expect(first).not.toEqual(second);
    vi.unstubAllEnvs();
  });

  it("押中数字给满分，押错给零分", () => {
    vi.stubEnv("AUTH_SECRET", "roulette-test-key-0123456789");
    const number = spin(USER);

    expect(judge(judgeRoulette, config, { text: String(number) }).score).toBe(100);
    expect(
      judge(judgeRoulette, config, { text: "not-a-bet" }).score,
    ).toBe(0);
    vi.unstubAllEnvs();
  });
});
