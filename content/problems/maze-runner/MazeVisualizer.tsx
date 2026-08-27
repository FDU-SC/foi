"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Cell = 0 | 1;

const DEFAULT_GRID: Cell[][] = [
  [0, 0, 0, 1, 0, 0, 0, 0],
  [1, 1, 0, 1, 0, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 1, 1, 1, 1, 0, 1, 0],
  [0, 0, 0, 0, 1, 0, 0, 0],
  [1, 1, 1, 0, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
];

const MOVES = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

interface Frame {
  visited: Set<number>;
  frontier: Set<number>;
  path: Set<number> | null;
}

function search(grid: Cell[][]): { frames: Frame[]; distance: number | null } {
  const rows = grid.length;
  const cols = grid[0].length;
  const key = (r: number, c: number) => r * cols + c;
  const goal = key(rows - 1, cols - 1);

  const frames: Frame[] = [];
  const visited = new Set<number>();
  const parent = new Map<number, number>();

  if (grid[0][0] === 1 || grid[rows - 1][cols - 1] === 1) {
    return { frames: [{ visited, frontier: new Set(), path: null }], distance: null };
  }

  let layer = [key(0, 0)];
  visited.add(layer[0]);
  let found = false;

  while (layer.length > 0 && !found) {
    frames.push({
      visited: new Set(visited),
      frontier: new Set(layer),
      path: null,
    });

    const next: number[] = [];
    for (const current of layer) {
      if (current === goal) {
        found = true;
        break;
      }
      const r = Math.floor(current / cols);
      const c = current % cols;
      for (const [dr, dc] of MOVES) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] === 1) continue;
        const nk = key(nr, nc);
        if (visited.has(nk)) continue;
        visited.add(nk);
        parent.set(nk, current);
        next.push(nk);
      }
    }

    if (found) break;
    layer = next;
  }

  if (!visited.has(goal)) {
    frames.push({ visited: new Set(visited), frontier: new Set(), path: null });
    return { frames, distance: null };
  }

  const path = new Set<number>();
  let cursor: number | undefined = goal;
  while (cursor !== undefined) {
    path.add(cursor);
    cursor = parent.get(cursor);
  }

  frames.push({ visited: new Set(visited), frontier: new Set(), path });
  return { frames, distance: path.size - 1 };
}

export function MazeVisualizer() {
  const [grid, setGrid] = useState<Cell[][]>(() =>
    DEFAULT_GRID.map((row) => [...row]),
  );
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const cols = grid[0].length;
  const { frames, distance } = useMemo(() => search(grid), [grid]);
  const frame = frames[Math.min(step, frames.length - 1)];
  const atEnd = step >= frames.length - 1;

  useEffect(() => {
    if (!playing || step >= frames.length - 1) return;
    const timer = setTimeout(() => setStep((current) => current + 1), 220);
    return () => clearTimeout(timer);
  }, [playing, step, frames.length]);

  const toggleCell = (r: number, c: number) => {
    if ((r === 0 && c === 0) || (r === grid.length - 1 && c === cols - 1)) return;
    setPlaying(false);
    setStep(0);
    setGrid((current) =>
      current.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? ((1 - cell) as Cell) : cell)) : row,
      ),
    );
  };

  const reset = () => {
    setPlaying(false);
    setStep(0);
    setGrid(DEFAULT_GRID.map((row) => [...row]));
  };

  return (
    <div className="border-border bg-surface my-6 overflow-hidden rounded-lg border">
      <div className="border-border bg-surface-2/50 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="text-fg text-sm font-semibold">交互式演示</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (atEnd) {
                setStep(0);
                setPlaying(true);
              } else {
                setPlaying((value) => !value);
              }
            }}
          >
            {atEnd ? "重新播放" : playing ? "暂停" : "播放搜索"}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setPlaying(false);
              setStep((current) => Math.min(current + 1, frames.length - 1));
            }}
            disabled={atEnd}
          >
            单步
          </Button>
          <Button size="sm" variant="ghost" onClick={reset}>
            重置
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6 px-4 py-4">
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${cols}, 1.75rem)` }}
        >
          {grid.map((row, r) =>
            row.map((cell, c) => {
              const id = r * cols + c;
              const isStart = r === 0 && c === 0;
              const isGoal = r === grid.length - 1 && c === cols - 1;
              const onPath = frame.path?.has(id);
              const inFrontier = frame.frontier.has(id);
              const seen = frame.visited.has(id);

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleCell(r, c)}
                  aria-label={`第 ${r + 1} 行第 ${c + 1} 列`}
                  className={cn(
                    "size-7 rounded-sm text-[10px] font-semibold transition-colors duration-150",
                    cell === 1 && "bg-fg/80",
                    cell === 0 && !seen && "bg-surface-3 hover:bg-border-strong",
                    cell === 0 && seen && !onPath && !inFrontier && "bg-info/25",
                    inFrontier && !onPath && "bg-info/60",
                    onPath && "bg-ok text-white",
                    isStart && "ring-primary ring-2 ring-inset",
                    isGoal && "ring-warn ring-2 ring-inset",
                  )}
                >
                  {isStart ? "S" : isGoal ? "T" : ""}
                </button>
              );
            }),
          )}
        </div>

        <dl className="min-w-40 space-y-2 text-sm">
          <div>
            <dt className="text-fg-subtle text-[11px] tracking-wide uppercase">
              最短步数
            </dt>
            <dd className="text-fg font-mono text-lg tabular-nums">
              {distance ?? "无解"}
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle text-[11px] tracking-wide uppercase">
              已扩展
            </dt>
            <dd className="text-fg font-mono tabular-nums">
              {frame.visited.size} 格
            </dd>
          </div>
          <p className="text-fg-subtle pt-1 text-xs leading-relaxed">
            点击格子可以切换墙壁，图会立即重新计算。
          </p>
        </dl>
      </div>
    </div>
  );
}
