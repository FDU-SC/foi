import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The HPC & AI Infra heading's first section: single-node, single-device work.
 *
 * Most of its problems are scored against a baseline rather than checked for
 * correctness alone. Each one ships its own driver through the `interactive`
 * backend — or, for the GPU problem, through `interactive-cuda-12-8`, which is
 * the same judge in an image carrying nvcc 12.8 — so the baseline, the scoring
 * formula and the compile flags all live in the problem's own config.
 *
 * `vadd` is the section's entry point and the exception: correctness only, no
 * baseline. It shows what a kernel submission looks like, and it is also how the
 * GPU judge's whole path gets exercised before anything is scored on speed.
 */
export const contest = {
  slug: "kernel",
  title: "算子与 Kernel",
  description: "从第一行 CUDA kernel 到按相对基线的加速比计分，都在单机单卡上。",

  domain: "HPC & AI Infra",
  facets: ["difficulty", "tags"],

  leaderboards: [
    {
      id: "main",
      title: "总分榜",
      ruleset: { id: "oi", config: { take: "best" } },
    },
  ],

  startsAt: "2025-01-01T00:00:00+08:00",
  endsAt: "2099-12-31T23:59:59+08:00",

  problems: [
    { slug: "perf-optimize" },
    { slug: "openmp-pi" },
    { slug: "sssp-hpc" },
    { slug: "vadd" },
    { slug: "lu" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
