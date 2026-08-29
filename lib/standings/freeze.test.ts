import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { allContests } from "@/lib/contests/registry";
import { groupWith } from "@/test/content-shapes";
import {
  at,
  input,
  participants,
  problem,
  solve,
  fail,
} from "@/test/standings-support";
import { listRulesets } from "./registry";
import type { AnyRuleset, SubmissionRecord } from "./types";

const allRulesets = listRulesets();

const problems = [problem("a", "A"), problem("b", "B")];

/**
 * Simulate the freeze masking that `loadAndCompute` applies:
 * submissions after `freezeAt` get `result: null`.
 */
function maskResults(
  subs: SubmissionRecord[],
  freezeAt: Date,
): SubmissionRecord[] {
  return subs.map((s) =>
    s.createdAt >= freezeAt ? { ...s, result: null } : s,
  );
}

describe("封榜：result 屏蔽后赛制行为", () => {
  it("至少有一种赛制可测", () => {
    expect(allRulesets.length).toBeGreaterThan(0);
  });

  const freezeAt = at(240);

  it.each(allRulesets.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：封榜后的提交被屏蔽后，公开分 ≤ 全量分",
    ({ ruleset }) => {
      const subs = [solve(1, "a", 10), solve(1, "b", 250)];
      const base = input({
        participants: participants(1),
        problems,
        submissions: subs,
      });

      const full = ruleset.compute(base);

      const masked = input({
        participants: participants(1),
        problems,
        submissions: maskResults(subs, freezeAt),
      });
      const pub = ruleset.compute(masked);

      expect(full.rows[0].total).toBeGreaterThanOrEqual(pub.rows[0].total);
    },
  );

  it.each(allRulesets.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：封榜前的提交不受影响",
    ({ ruleset }) => {
      const subs = [solve(1, "a", 10), solve(1, "b", 60)];
      const base = input({
        participants: participants(1),
        problems,
        submissions: subs,
      });

      const masked = input({
        participants: participants(1),
        problems,
        submissions: maskResults(subs, freezeAt),
      });

      const shape = (b: { rows: { total: number; tiebreak: number }[] }) =>
        b.rows.map((r) => [r.total, r.tiebreak]);

      expect(shape(ruleset.compute(masked))).toEqual(
        shape(ruleset.compute(base)),
      );
    },
  );

  it.each(allRulesets.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：管理员视角（不屏蔽）看到完整分数",
    ({ ruleset }) => {
      const subs = [solve(1, "a", 10), solve(1, "b", 250)];
      const base = input({
        participants: participants(1),
        problems,
        submissions: subs,
      });

      const full = ruleset.compute(base);
      expect(full.rows[0].total).toBeGreaterThan(0);
    },
  );
});

describe("封榜 pending 语义（赛制 Cell 含 pending 字段的）", () => {
  const freezeAt = at(240);

  // Find rulesets whose cells expose { pending, attempts } — test them specifically.
  function cellShape(ruleset: AnyRuleset) {
    const base = input({
      participants: participants(1),
      problems,
      submissions: [solve(1, "a", 10)],
    });
    const cell = ruleset.compute(base).rows[0]?.cells["a"];
    return cell && typeof (cell as Record<string, unknown>).pending === "number";
  }

  const withPending = allRulesets.filter(cellShape);

  it("至少有一种赛制的 Cell 含 pending 字段", () => {
    expect(withPending.length).toBeGreaterThan(0);
  });

  it.each(withPending.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：封榜后的 AC 提交在公开视角下标记为 pending",
    ({ ruleset }) => {
      const subs = [solve(1, "a", 250)];
      const base = input({
        participants: participants(1),
        problems,
        submissions: maskResults(subs, freezeAt),
      });

      const result = ruleset.compute(base);
      const cell = result.rows[0].cells["a"] as {
        pending: number;
        attempts: number;
      };
      expect(cell.pending).toBe(1);
      expect(cell.attempts).toBe(0);
    },
  );

  it.each(withPending.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：封榜前的提交正常计分，pending 为 0",
    ({ ruleset }) => {
      const subs = [solve(1, "a", 10)];
      const base = input({
        participants: participants(1),
        problems,
        submissions: maskResults(subs, freezeAt),
      });

      const result = ruleset.compute(base);
      const cell = result.rows[0].cells["a"] as {
        pending: number;
        attempts: number;
      };
      expect(cell.pending).toBe(0);
      expect(cell.attempts).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(withPending.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：封榜前 WA + 封榜后 AC → 公开视角：有失败 + 有 pending",
    ({ ruleset }) => {
      const subs = [fail(1, "a", 100), solve(1, "a", 250)];
      const base = input({
        participants: participants(1),
        problems,
        submissions: maskResults(subs, freezeAt),
      });

      const result = ruleset.compute(base);
      const cell = result.rows[0].cells["a"] as {
        pending: number;
        attempts: number;
      };
      expect(cell.attempts).toBeGreaterThanOrEqual(1);
      expect(cell.pending).toBe(1);
    },
  );
});

describe("谁能看穿封榜", () => {
  const contest = allContests()[0];

  it.skipIf(!contest)("选手不能", () => {
    expect(
      allows("standings.readUnfrozen", contest!, viewerFor({ uid: 1, groups: [] })),
    ).toBe(false);
    expect(allows("standings.readUnfrozen", contest!, AS_PLAYER)).toBe(false);
  });

  it.skipIf(!contest)("被策略点名的组能", () => {
    const group = groupWith("standings.readUnfrozen");
    expect(
      allows("standings.readUnfrozen", contest!, viewerFor({ uid: 2, groups: [group] })),
    ).toBe(true);
  });

  it.skipIf(!contest)("能读他人提交的人也能看穿，否则他自己就能把分加出来", () => {
    const group = groupWith("submission.read");
    const viewer = viewerFor({ uid: 3, groups: [group] });

    expect(allows("standings.readUnfrozen", contest!, viewer)).toBe(true);
  });
});
