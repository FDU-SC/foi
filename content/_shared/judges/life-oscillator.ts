import "server-only";
import type { InlineJudge } from "@/lib/problems/types";

type LifeGrid = number[][];

interface PeriodicCase {
  name?: string;

  maxDim: number;

  k: number;
}

export interface LifeOscillatorConfig {
  cases: PeriodicCase[];
}

function lifeStep(grid: LifeGrid): LifeGrid {
  const rows = grid.length;
  const cols = grid[0].length;
  const next: LifeGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let neighbors = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (di === 0 && dj === 0) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && ni < rows && nj >= 0 && nj < cols && grid[ni][nj]) {
            neighbors++;
          }
        }
      }
      next[i][j] = grid[i][j]
        ? neighbors === 2 || neighbors === 3
          ? 1
          : 0
        : neighbors === 3
          ? 1
          : 0;
    }
  }
  return next;
}

function lifeEquals(a: LifeGrid, b: LifeGrid): boolean {
  return a.every((row, i) => row.every((cell, j) => cell === b[i][j]));
}

function lifePadded(grid: LifeGrid, pad: number): LifeGrid {
  const rows = grid.length;
  const cols = grid[0].length;
  const out: LifeGrid = Array.from({ length: rows + 2 * pad }, () =>
    Array(cols + 2 * pad).fill(0),
  );
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[i + pad][j + pad] = grid[i][j];
  }
  return out;
}

function lifeParse(text: string): LifeGrid | null {
  const rows: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const row: number[] = [];
    for (const ch of line) {
      if (ch === "." || ch === "0") row.push(0);
      else if (ch === "O" || ch === "1") row.push(1);
      else return null;
    }
    rows.push(row);
  }
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array(width - row.length).fill(0)]);
}

export const judgeLifeOscillator: InlineJudge = ({ payload, config }) => {

  const cases = (
    (config as LifeOscillatorConfig | undefined)?.cases ?? []
  ).filter((testCase) => testCase.k > 0 && testCase.maxDim > 0);

  if (cases.length === 0) {
    return {
      unavailable: true,
      reason: "题目配置没有可用的 cases（k 与 maxDim 必须为正），无法判题",
    };
  }

  const text = String((payload as { text?: unknown })?.text ?? "");
  const grids = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const perCase = 100 / cases.length;
  const tests = cases.map((testCase, index) => {
    const name = testCase.name ?? `场景 ${index + 1}`;
    const fail = (message: string) => ({
      name,
      status: "wrong_answer" as const,
      score: 0,
      maxScore: perCase,
      message,
    });

    const grid = lifeParse(grids[index] ?? "");
    if (!grid) {
      return fail("提交的网格缺失或格式不对（每行只能包含 . 和 O）");
    }

    const dim = testCase.maxDim ?? 50;
    if (grid.length > dim || grid[0].length > dim) {
      return fail(`尺寸 ${grid.length}×${grid[0].length} 超过上限 ${dim}×${dim}`);
    }
    if (grid.flat().every((cell) => cell === 0)) {
      return fail("图案为空：至少需要 1 个活细胞");
    }

    const k = testCase.k ?? 2;
    const PAD = 8;
    let current = lifePadded(grid, PAD);
    const initial = current;
    for (let t = 1; t <= k; t++) {
      current = lifeStep(current);
      if (t < k) {
        if (lifeEquals(current, initial)) {
          return fail(`第 ${t} 代就回到了初始状态——最小周期是 ${t}，不是 ${k}`);
        }
      } else if (!lifeEquals(current, initial)) {
        return fail(`第 ${k} 代没有回到初始状态——这不是 ${k} 周期`);
      }
    }

    return {
      name,
      status: "accepted" as const,
      score: perCase,
      maxScore: perCase,
      message: `最小周期恰为 ${k} ✓（${grid.length}×${grid[0].length}，${grid.flat().filter(Boolean).length} 个活细胞）`,
    };
  });

  const passed = tests.filter((test) => test.status === "accepted").length;
  const allPassed = passed === cases.length;

  return {
    result: {
      status: allPassed ? "accepted" : passed > 0 ? "partial" : "wrong_answer",
      accepted: allPassed,
      score: allPassed ? 100 : passed * perCase,
      maxScore: 100,
    },
    detail: { tests },
  };
};
