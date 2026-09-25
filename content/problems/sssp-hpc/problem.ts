import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * HPC 单源最短路 —— 来自 hpcgame-problems-3rd 的 sssp。
 *
 * 与平台上其它题不同，选手交的是**一个函数**而不是完整程序：
 *
 *   void calculate(uint32_t n, uint32_t m, uint32_t *edges, uint64_t *dis);
 *
 * 驱动（下面的 DRIVER）负责造图、给 calculate() 计时、当场算参考解并比对，
 * 最后按 hpcgame 的公式给分：正确时 base + perf * min(goal / time, 1)。
 * 平台与判题机都不认识最短路——判定全在驱动里。
 *
 * DRIVER 是这道题唯一的实现：判题机不认识最短路，只负责铺文件、跑 make、
 * 读回下面这行 FOI_RESULT。
 */
const DRIVER = `#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <queue>
#include <random>
#include <vector>

const uint64_t MAX_WEIGHT = 1e7;
const uint64_t INF = 1e18;

void calculate(uint32_t n, uint32_t m, uint32_t *edges, uint64_t *dis);

// Identical to the upstream generator, including the dist(0, i) that keeps the
// first n-1 edges a tree and so guarantees every vertex is reachable.
static void random_edges(uint32_t n, uint32_t m, uint32_t seed,
                         std::vector<uint32_t> &edges) {
    std::mt19937_64 gen(seed);
    std::uniform_int_distribution<uint32_t> gen_node(0, n - 1);
    std::uniform_int_distribution<uint32_t> gen_weight(1, MAX_WEIGHT);

    for (uint32_t i = 0; i < n - 1; ++i) {
        uint32_t u = std::uniform_int_distribution<size_t>(0, i)(gen);
        uint32_t v = i + 1;
        uint32_t w = gen_weight(gen);
        edges[i * 3] = u;
        edges[i * 3 + 1] = v;
        edges[i * 3 + 2] = w;
    }
    for (uint32_t i = n - 1; i < m; ++i) {
        uint32_t u = gen_node(gen);
        uint32_t v = gen_node(gen);
        uint32_t w = gen_weight(gen);
        edges[i * 3] = u;
        edges[i * 3 + 1] = v;
        edges[i * 3 + 2] = w;
    }
}

// The judge cannot use the upstream std solution as an oracle: it relaxes with
// relaxed atomics across threads, so its byte output is not stable. Serial
// Dijkstra is deterministic, which is what a reference has to be.
static void reference(uint32_t n, uint32_t m, const std::vector<uint32_t> &edges,
                      std::vector<uint64_t> &dis) {
    struct arc { uint32_t to, w; };
    std::vector<std::vector<arc>> adj(n);
    for (uint32_t i = 0; i < m; ++i) {
        adj[edges[i * 3]].push_back({edges[i * 3 + 1], edges[i * 3 + 2]});
    }
    using item = std::pair<uint64_t, uint32_t>;
    std::priority_queue<item, std::vector<item>, std::greater<item>> pq;
    std::vector<char> done(n, 0);
    dis.assign(n, INF);
    dis[0] = 0;
    pq.push({0, 0});
    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();
        if (done[u]) continue;
        done[u] = 1;
        for (const arc &a : adj[u]) {
            uint64_t nd = d + a.w;
            if (nd < dis[a.to]) { dis[a.to] = nd; pq.push({nd, a.to}); }
        }
    }
}

int main(int argc, char **argv) {
    if (argc != 7) {
        fprintf(stderr, "usage: %s <n> <m> <seed> <base> <perf> <goal_ms>\\n", argv[0]);
        return 2;
    }
    uint32_t n = (uint32_t)strtoul(argv[1], nullptr, 10);
    uint32_t m = (uint32_t)strtoul(argv[2], nullptr, 10);
    uint32_t seed = (uint32_t)strtoul(argv[3], nullptr, 10);
    int base = atoi(argv[4]);
    int perf = atoi(argv[5]);
    double goal_ms = atof(argv[6]);

    std::vector<uint32_t> edges((size_t)m * 3);
    random_edges(n, m, seed, edges);

    std::vector<uint64_t> mine(n, INF), want(n, INF);
    mine[0] = 0;

    auto t0 = std::chrono::steady_clock::now();
    calculate(n, m, edges.data(), mine.data());
    auto t1 = std::chrono::steady_clock::now();
    double time_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

    reference(n, m, edges, want);

    size_t wrong = 0;
    uint32_t first_bad = 0;
    for (uint32_t i = 0; i < n; ++i) {
        if (mine[i] != want[i]) { if (wrong == 0) first_bad = i; ++wrong; }
    }

    fflush(stdout);
    fprintf(stderr, "Time: %.6f seconds\\n", time_ms / 1000.0);

    if (wrong != 0) {
        printf("FOI_RESULT {\\"score\\":0,\\"maxScore\\":%d,\\"status\\":\\"wrong_answer\\","
               "\\"message\\":\\"%zu/%u 个距离不对，首个是 dis[%u]=%llu（应为 %llu）\\"}\\n",
               base + perf, wrong, n, first_bad, (unsigned long long)mine[first_bad],
               (unsigned long long)want[first_bad]);
        return 0;
    }

    double ratio = goal_ms > 0 ? goal_ms / (time_ms > 0 ? time_ms : goal_ms) : 0.0;
    if (ratio > 1.0) ratio = 1.0;
    int score = base + (int)(perf * ratio);
    printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":%d,\\"status\\":\\"%s\\","
           "\\"message\\":\\"n=%u m=%u，耗时 %.1f ms（goal %.1f ms）\\"}\\n",
           score, base + perf, score >= base + perf ? "accepted" : "partial",
           n, m, time_ms, goal_ms);
    return 0;
}
`;

const MAKEFILE = `CXX      ?= g++
CXXFLAGS ?= -O3 -std=c++20 -flto -fopenmp -pthread

all: sssp

sssp: driver.cpp contestant.cpp
\t$(CXX) $(CXXFLAGS) -o $@ $^

clean:
\trm -f sssp
`;

/**
 * 测试点取自 hpcgame 官方表格，但**规模缩小了**。
 *
 * 官方那七行最大到 n=1e7 / m=1e9 / 100 秒上限。判题机的参考解在 m=1e9 时
 * 需要约 20 GB——光驱动传给 calculate() 的边表就是 m × 12 字节，12 GB——
 * 所以 16 GB 的宿主跑不动那一档。这里保留前三档的结构与 base/perf/goal
 * 语义，规模降到秒级可完成（实测峰值 108 MB）。宿主内存够了再按官方
 * 表格替换 CASES 即可，config 结构不用动。
 */
const CASES = [
  {
    name: "1e5 点 / 2e5 边",
    argv: ["./sssp", "100000", "200000", "42", "10", "10", "5"],
    threads: 16,
    timeLimitMs: 30000,
    maxScore: 20,
  },
  {
    name: "1e5 点 / 1e6 边",
    argv: ["./sssp", "100000", "1000000", "42", "5", "15", "60"],
    threads: 16,
    timeLimitMs: 30000,
    maxScore: 20,
  },
  {
    name: "1e6 点 / 2e6 边",
    argv: ["./sssp", "1000000", "2000000", "42", "5", "5", "1200"],
    threads: 16,
    timeLimitMs: 60000,
    maxScore: 10,
  },
];

export const problem = {
  slug: "sssp-hpc",
  title: "HPC 单源最短路 · 并行加速",
  maxScore: 50,
  backend: {
    id: "interactive",
    config: {
      files: [
        { path: "makefile", content: MAKEFILE },
        { path: "driver.cpp", content: DRIVER },
        { path: "contestant.cpp", content: "(由提交内容覆盖)" },
      ],
      makefile: "makefile",
      contestant: "contestant.cpp",
      build: {
        target: "all",
        artifact: "sssp",
        wallMs: 120000,
        memoryMb: 2048,
        threads: 16,
      },
      run: {
        argv: ["./sssp", "100000", "200000", "42", "10", "10", "5"],
      },
      result: { required: true },
      cases: CASES.map((item) => ({
        name: item.name,
        argv: item.argv,
        threads: item.threads,
        timeLimitMs: item.timeLimitMs,
        maxScore: item.maxScore,
      })),
      seed: 42,
      memoryLimitMb: 1024,
      // 每线程 32 MB 栈，足以覆盖深递归解法。判题机据此推导地址空间
      // （1024 + 16×32 + 16 = 1552 MB），所以栈一定装得下。
      stackLimitMb: 32,
    },
  },
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的实现（实现 calculate，不要写 main）",
    tags: ["性能优化", "OpenMP", "图论", "HPC"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
