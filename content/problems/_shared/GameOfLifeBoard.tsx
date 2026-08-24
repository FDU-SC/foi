"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Grid = number[][];

const SIZES = [8, 12, 16, 20, 24, 32, 40, 50] as const;

function emptyGrid(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () => Array<number>(cols).fill(0));
}

/** Parses '.', 'O', '0', '1' rows into a grid (rectangular; pads short rows). */
function parseGrid(lines: string[], rows: number, cols: number): Grid | null {
  const cells: number[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const row: number[] = [];
    for (const ch of line) {
      if (ch === "." || ch === "0") row.push(0);
      else if (ch === "O" || ch === "1") row.push(1);
      else return null;
    }
    if (row.length > cols) return null;
    cells.push(row);
  }
  if (cells.length === 0 || cells.length > rows) return null;
  const width = Math.max(...cells.map((row) => row.length));
  return cells.map((row) => [
    ...row,
    ...Array<number>(width - row.length).fill(0),
  ]);
}

/** Cuts empty border rows/columns off a grid. */
function crop(grid: Grid): Grid {
  const rows = grid.filter((row) => row.some((cell) => cell === 1));
  if (rows.length === 0) return [[]];
  const cols = rows[0].length;
  let minC = cols;
  let maxC = -1;
  for (const row of rows) {
    for (let c = 0; c < cols; c++) {
      if (row[c]) {
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }
  return rows.map((row) => row.slice(minC, maxC + 1));
}

function toText(grid: Grid): string {
  const cropped = crop(grid);
  if (cropped[0].length === 0) return "";
  return cropped
    .map((row) => row.map((cell) => (cell ? "O" : ".")).join(""))
    .join("\n");
}

function nextGeneration(grid: Grid): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const next = emptyGrid(rows, cols);
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

const signature = (grid: Grid) => JSON.stringify(grid);

/**
 * An interactive Game of Life board shared by the life problems.
 *
 * Click cells to paint, play/step to watch evolution, and the board detects
 * when the pattern enters a cycle (with the minimal period) — which is the
 * whole game for the oscillator problem. "跳到第 N 代" runs a simulation in
 * one jump, and the export button copies the cropped `.`/`O` text for
 * submission.
 *
 * Evolution follows the judge's rules exactly: cells outside the grid are
 * dead, nothing wraps around. Cycle detection matches the judge too: the
 * board simulates in place, and a repeat of any earlier state (including the
 * initial one) is reported with its minimal period.
 */
export function GameOfLifeBoard({
  maxRows = 50,
  maxCols = 50,
  defaultRows = 16,
  defaultCols = 16,
  initial,
  maxGenerations = 500,
  showJump = true,
}: {
  maxRows?: number;
  maxCols?: number;
  defaultRows?: number;
  defaultCols?: number;
  initial?: string[];
  maxGenerations?: number;
  showJump?: boolean;
}) {
  const [rows, setRows] = useState(Math.min(defaultRows, maxRows));
  const [cols, setCols] = useState(Math.min(defaultCols, maxCols));
  const [grid, setGrid] = useState<Grid>(() => {
    const fromInitial = initial ? parseGrid(initial, maxRows, maxCols) : null;
    if (fromInitial) return fromInitial;
    return emptyGrid(
      Math.min(defaultRows, maxRows),
      Math.min(defaultCols, maxCols),
    );
  });
  const [generation, setGeneration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cycle, setCycle] = useState<{ period: number; enteredAt: number } | null>(null);
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState("100");
  const [copied, setCopied] = useState(false);

  /** The user-authored starting pattern; playback can rewind to it. */
  const initialRef = useRef(grid);
  /** Every generation seen (signature -> generation), for cycle detection. */
  const historyRef = useRef<Map<string, number>>(new Map([[signature(grid), 0]]));

  const alive = useMemo(
    () => grid.flat().reduce((sum, cell) => sum + cell, 0),
    [grid],
  );

  /** Replaces the pattern; used by every editing operation. */
  const applyEdit = (next: Grid) => {
    setPlaying(false);
    setCycle(null);
    setGeneration(0);
    initialRef.current = next;
    historyRef.current = new Map([[signature(next), 0]]);
    setGrid(next);
  };

  const stepOnce = useCallback(() => {
    const next = nextGeneration(grid);
    const sig = signature(next);
    const firstSeen = historyRef.current.get(sig);
    if (firstSeen !== undefined) {
      setCycle({ period: generation + 1 - firstSeen, enteredAt: firstSeen });
    } else {
      historyRef.current.set(sig, generation + 1);
    }
    setGrid(next);
    setGeneration((g) => g + 1);
  }, [grid, generation]);

  // Playback ticks inside the timer, so nothing calls setState synchronously
  // in the effect itself; a found cycle or the generation cap simply stops
  // scheduling the next tick.
  useEffect(() => {
    if (!playing) return;
    if (cycle || generation >= maxGenerations) return;
    const timer = setTimeout(stepOnce, 150);
    return () => clearTimeout(timer);
  }, [playing, generation, cycle, maxGenerations, stepOnce]);

  const toggleCell = (r: number, c: number) => {
    const next = grid.map((row, ri) =>
      ri === r
        ? row.map((cell, ci) => (ci === c ? (1 - cell) as number : cell))
        : row,
    );
    applyEdit(next);
  };

  const resize = (size: number) => {
    setRows(size);
    setCols(size);
    applyEdit(emptyGrid(size, size));
  };

  const randomize = () => {
    applyEdit(
      Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => (Math.random() < 0.25 ? 1 : 0)),
      ),
    );
  };

  const clear = () => applyEdit(emptyGrid(rows, cols));

  const jump = () => {
    const target = Math.min(Math.max(1, Number(jumpTo) || 0), maxGenerations);
    setPlaying(false);
    setCycle(null);
    let current = grid;
    let gen = generation;
    historyRef.current = new Map([[signature(current), gen]]);
    for (let i = 0; i < target; i++) {
      current = nextGeneration(current);
      gen += 1;
      const sig = signature(current);
      const firstSeen = historyRef.current.get(sig);
      if (firstSeen !== undefined) {
        setCycle({ period: gen - firstSeen, enteredAt: firstSeen });
        break;
      }
      historyRef.current.set(sig, gen);
    }
    setGrid(current);
    setGeneration(gen);
  };

  const doImport = () => {
    const parsed = parseGrid(importText.split("\n"), rows, cols);
    if (!parsed) {
      setError("格式不对：每行只能包含 . O（或 0 1），且行列数不能超出当前画板");
      return;
    }
    setError(null);
    applyEdit(parsed);
  };

  const rewind = () => {
    const start = initialRef.current;
    historyRef.current = new Map([[signature(start), 0]]);
    setGeneration(0);
    setCycle(null);
    setGrid(start);
    setPlaying(true);
  };

  const copyPattern = async () => {
    if (!toText(grid)) return;
    try {
      await navigator.clipboard.writeText(toText(grid));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; nothing to do.
    }
  };

  const playClick = () => {
    if (cycle && generation > 0) {
      rewind();
    } else {
      setPlaying((value) => !value);
    }
  };

  return (
    <div className="border-border bg-surface my-6 overflow-hidden rounded-lg border">
      <div className="border-border bg-surface-2/50 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="text-fg text-sm font-semibold">生命游戏模拟器</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            value={String(rows)}
            onChange={(e) => resize(Number(e.target.value))}
            className="w-24"
            aria-label="画板尺寸"
          >
            {SIZES.filter((s) => s <= maxRows && s <= maxCols).map((s) => (
              <option key={s} value={s}>
                {s}×{s}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" onClick={playClick}>
            {playing ? "暂停" : cycle && generation > 0 ? "重新播放" : "播放"}
          </Button>
          <Button size="sm" onClick={stepOnce} disabled={playing}>
            单步
          </Button>
          <Button size="sm" variant="ghost" onClick={randomize}>
            随机
          </Button>
          <Button size="sm" variant="ghost" onClick={clear}>
            清空
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6 px-4 py-4">
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {grid.map((row, r) =>
            row.map((cell, c) => (
              <button
                key={`${r}-${c}`}
                type="button"
                onClick={() => toggleCell(r, c)}
                aria-label={`第 ${r + 1} 行第 ${c + 1} 列`}
                className={cn(
                  "aspect-square rounded-[2px] transition-colors duration-100",
                  cols > 24 ? "size-2.5" : cols > 16 ? "size-3.5" : "size-5",
                  cell ? "bg-ok" : "bg-surface-3 hover:bg-border-strong",
                )}
              />
            )),
          )}
        </div>

        <div className="min-w-44 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-fg-subtle text-[11px] uppercase tracking-wide">代数</span>
            <span className="text-fg font-mono tabular-nums">{generation}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-fg-subtle text-[11px] uppercase tracking-wide">活细胞</span>
            <span className="text-fg font-mono tabular-nums">{alive}</span>
          </div>
          {cycle ? (
            <div className="flex items-center gap-2">
              <Badge tone="ok">周期 {cycle.period}</Badge>
              <span className="text-fg-subtle text-xs">
                第 {cycle.enteredAt} 代进入循环
              </span>
            </div>
          ) : (
            <p className="text-fg-subtle text-xs leading-relaxed">
              点击格子绘制图案，播放观察演化；进入循环时自动停下并报告周期。
            </p>
          )}

          {showJump ? (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="number"
                min={1}
                max={maxGenerations}
                value={jumpTo}
                onChange={(e) => setJumpTo(e.target.value)}
                className="border-border bg-surface-2 text-fg w-20 rounded-md border px-2 py-1 font-mono text-xs"
                aria-label="跳转到第几代"
              />
              <Button size="sm" variant="secondary" onClick={jump}>
                跳到第 {jumpTo || "N"} 代
              </Button>
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void copyPattern()}
              disabled={!alive}
            >
              {copied ? "已复制 ✓" : "复制图案（裁剪后）"}
            </Button>
          </div>

          <details className="pt-1 text-xs">
            <summary className="text-fg-subtle cursor-pointer">
              导入图案（粘贴 . / O 文本）
            </summary>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={4}
              spellCheck={false}
              className="border-border bg-surface-2 text-fg mt-2 w-full rounded-md border px-2 py-1 font-mono text-[11px]"
              placeholder={".OO..\nO..O.\n.OO.."}
            />
            <Button size="sm" onClick={doImport} className="mt-1">
              载入
            </Button>
            {error ? <p className="text-err mt-1">{error}</p> : null}
          </details>
        </div>
      </div>
    </div>
  );
}
