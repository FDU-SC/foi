import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

const API = `
int query(int x);
void answer(int x);
`;

const DRIVER = `
#include <cstdio>
#include <cstdlib>

int g_lo = 1;
int g_hi = 2;
int g_n = 0;
int q_cnt = 0;
int g_submit = 0;
int g_answer = 0;

int query(int x);
void answer(int x);

void solve(int n);

int query(int x) {
    int mid = (g_lo + g_hi) / 2;
    ++q_cnt;
    if (x < g_lo) {
        return 1;
    }
    else if (x >= g_hi) {
        return 0;
    }
    else if (x <= mid) {
        g_lo = x + 1;
        return 1;
    } else {
        g_hi = x;
        return 0;
    }
}

void answer(int x) {
    g_submit = 1;
    g_answer = x;
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <n>\\n", argv[0]);
        return 2;
    }
    g_n = atoi(argv[1]);
    q_cnt = 0;
    g_lo = 1;
    g_hi = g_n;
    g_submit = 0;
    g_answer = 0;
    solve(g_n);
    bool correct = true;
    if (!g_submit) {
        correct = false;
    }
    if (g_lo != g_hi) {
        correct = false;
    }
    if (g_answer != g_lo) {
        correct = false;
    }
    int score = correct ? (q_cnt <= 30 ? 100 : 50) : 0;
    const char *status = score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer";
    const char *what = !g_submit ? "solve() 结束时没有调用 answer()"
                       : correct   ? "答案正确"
                                   : "答案错误";
    printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":100,\\"status\\":\\"%s\\","
           "\\"message\\":\\"%s，用了 %d 次查询（上限 %d）\\"}\\n",
           score, status, what, q_cnt, 30);

    return 0;
}
`;

const MAKEFILE = `
CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++17 -include api.h

all: driver

driver: driver.cpp contestant.cpp
\t$(CXX) $(CXXFLAGS) -o $@ $^

clean:
\trm -f driver
`;

const CASES = [
  {
    name: "1000000",
    argv: ["./driver", "1000000"],
    threads: 16,
    timeLimitMs: 3000,
    maxScore: 100,
  },
];

export const problem = {
  slug: "interactive-binary-search",
  title: "交互式二分查找",
  maxScore: 100,
  backend: {
    id: "interactive",
    config: {
      files: [
        { path: "makefile", content: MAKEFILE },
        { path: "driver.cpp", content: DRIVER },
        { path: "api.h", content: API },
        { path: "contestant.cpp", content: "(由提交内容覆盖)" },
      ],
      makefile: "makefile",
      contestant: "contestant.cpp",
      build: {
        target: "all",
        artifact: "driver",
        wallMs: 20000,
        memoryMb: 2048,
        threads: 16,
      },
      run: {
        argv: ["./driver", "1000000"],
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
    placeholder: "粘贴你的实现（实现 solve，不要写 main）",
    tags: ["交互", "二分"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
