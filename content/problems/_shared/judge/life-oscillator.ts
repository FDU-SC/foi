import "server-only";
import type { InlineJudge } from "@/lib/problems/types";

/**
 * Inline judging for the oscillator problem: a Special Judge that verifies a
 * property rather than comparing against one fixed answer.
 *
 * This is the case that tests the inline/backend line, because unlike a string
 * comparison it genuinely computes — it simulates Game of Life. It stays on
 * this side because the work is bounded by the *configuration* rather than by
 * the submission: `maxDim` caps the grid and `k` caps the generations, both
 * written by the setter. The size check below is what makes that true, which
 * is why it runs before the simulation and not after. At the largest scene
 * shipped today that is a 66×66 field for four generations — tens of
 * microseconds.
 *
 * If a future scene wants a field big enough that the number matters, that is
 * the signal to move this problem to a backend, not to raise the cap here.
 * Synchronous JavaScript cannot be preempted: a judge that runs long does not
 * slow this request down, it stops the process from serving any other.
 */
type LifeGrid = number[][];

interface PeriodicCase {
  name?: string;
  /** Largest submitted grid accepted, in either dimension. */
  maxDim: number;
  /** The exact minimal period the pattern must have. */
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

/** Surrounds the pattern with dead cells so its evolution can breathe. */
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

/** Parses '.', 'O', '0', '1' rows into a rectangular grid; null on bad input. */
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

/**
 * Each scene asks for a pattern whose *minimal* period is exactly k — the k-th
 * generation equals the initial state and no earlier generation does.
 *
 * Simulation runs on a generously padded field, because intermediate states
 * commonly breathe wider than the submitted box: a 13×13 pulsar only has
 * period 3 when its frame sits inside a larger one. The size check still
 * applies to the submitted grid itself, and it applies first.
 */
export const judgeLifeOscillator: InlineJudge = ({ payload, config }) => {
  const cases = (
    (config as LifeOscillatorConfig | undefined)?.cases ?? []
  ).filter((testCase) => testCase.k !== undefined && testCase.maxDim !== undefined);

  if (cases.length === 0) {
    return {
      status: "system_error",
      score: 0,
      maxScore: 100,
      detail: { message: "题目配置缺少 cases" },
    };
  }

  const text = String((payload as { text?: unknown })?.text ?? "");
  const grids = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const perCase = 100 / cases.length;
  let score = 0;
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

    // Before the simulation, and that ordering is what bounds the work: every
    // generation below costs O(maxDim²), and nothing else caps the grid.
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

    score += perCase;
    return {
      name,
      status: "accepted" as const,
      score: perCase,
      maxScore: perCase,
      message: `最小周期恰为 ${k} ✓（${grid.length}×${grid[0].length}，${grid.flat().filter(Boolean).length} 个活细胞）`,
    };
  });

  return {
    status: score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer",
    score,
    maxScore: 100,
    detail: { tests },
  };
};
