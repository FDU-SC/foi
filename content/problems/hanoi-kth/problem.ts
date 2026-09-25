import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * 汉诺塔 · 第 k 步。
 *
 * 判定与计分都在下面的驱动里：驱动现场生成测试点（确定性 PRNG，种子写死），
 * 用内置的参考解算出期望输出，再逐个跑选手的实现做比对，最后按子任务给分。
 * 判题机不认识汉诺塔，只负责铺文件、跑 make、读回一行 FOI_RESULT。
 *
 * 数据策略与旧的 traditional 判题机相反：那边是**构建镜像时**把 .in/.out 烤进
 * 镜像，配置里只留 testdata: "<slug>/<version>"；这里是**判题时现场生成**，
 * 平台侧因此不需要存任何数据文件，题目配置里也只有一个随机种子。
 *
 * 选手提交的是**完整程序**（contestantOwnsMain: true）：自己写 main()、从 stdin
 * 读 n 与 k、往 stdout 写两个柱子。驱动把它当子进程 exec，所以选手的 I/O 与
 * 参考解完全一致，比对才有意义。
 */

const MAKEFILE = `CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++17

# 整条 recipe 交给同一个 shell：默认每条 recipe 行都是独立 shell。
.ONESHELL:

.PHONY: all clean

# 选手提交完整程序（contestantOwnsMain: true），所以编成独立可执行文件；
# 驱动自己 exec 它，两者不链接在一起。
contestant: contestant.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<

# 驱动编译时不需要选手代码，所以 driver.cpp 单独成可执行文件。
driver.o: driver.cpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

hanoi-kth: driver.o
	$(CXX) $(CXXFLAGS) -o $@ driver.o

# 判题机跑 make all，所以两个产物都要挂在这里。
all: hanoi-kth contestant

clean:
	rm -f hanoi-kth contestant driver.o
`;

/**
 * 评测驱动。无命令行参数——测试点全部由这里的生成器产生。
 *
 * 数据生成逻辑逐字对应旧判题机里的
 * `foi-runners-internal/traditional/src/problems/hanoi-kth/gen.ts`：
 * 同一套 mulberry32、同一个种子、同样的抽取顺序，所以生成出来的 k 与旧数据
 * 完全一致。改这里等于改测试数据。
 *
 * 计分按子任务：某子任务内所有测试点都对才拿到该子任务的分，与旧判题机一致。
 */
const DRIVER = `#include <bits/stdc++.h>

#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace std;

// ---- 数据生成：与旧 gen.ts 逐字对应 ----

// mulberry32，与旧 src/gen/rng.ts 相同：小、快、跨运行一致。
struct Rng {
    uint32_t s;
    explicit Rng(uint32_t seed) : s(seed) {}
    double next() {
        s = (uint32_t)(s + 0x6d2b79f5u);
        uint32_t t = s;
        t = (uint32_t)((t ^ (t >> 15)) * (t | 1u));
        t ^= t + (uint32_t)((t ^ (t >> 7)) * (t | 61u));
        return (double)((t ^ (t >> 14))) / 4294967296.0;
    }
};

struct Case {
    long long n;
    unsigned long long k;
};

vector<vector<Case>> generate() {
    Rng random(0x48414e4fu);
    vector<vector<Case>> out(3);

    auto total = [](long long n) { return (1ull << n) - 1ull; };
    auto randomK = [&](long long n) {
        const unsigned long long t = total(n);
        if (t <= 1ull) return 1ull;
        unsigned long long bits = 0;
        for (int i = 0; i < 4; i++)
            bits = (bits << 16) | (unsigned long long)floor(random.next() * 65536.0);
        return (bits % t) + 1ull;
    };
    // 边界：第 1 步、最后一步、正中间，以及中间的两侧。
    auto pushEdges = [&](int index, long long n) {
        const unsigned long long t = total(n);
        const unsigned long long middle = 1ull << (n - 1);
        out[index].push_back({n, 1ull});
        out[index].push_back({n, t});
        out[index].push_back({n, middle});
        if (t > 1ull) {
            out[index].push_back({n, middle - 1ull});
            out[index].push_back({n, middle + 1ull});
        }
    };
    auto pushRandoms = [&](int index, const vector<long long> &ns) {
        for (long long n : ns) out[index].push_back({n, randomK(n)});
    };

    // 顺序必须与旧 gen.ts 一致，否则随机序列会错位。
    out[0].push_back({3, 4});
    out[0].push_back({3, 5});
    out[0].push_back({2, 3});
    out[0].push_back({1, 1});
    pushEdges(0, 10);
    pushRandoms(0, {2, 4, 6, 7, 9});

    pushEdges(1, 30);
    pushRandoms(1, {11, 17, 23, 29, 30});

    pushEdges(2, 60);
    pushRandoms(2, {31, 45, 59, 60, 60});

    return out;
}

// ---- 参考解：与旧 std.cpp 相同，O(n) 定位第 k 步 ----

string reference(long long n, unsigned long long k) {
    char from = 'A', to = 'C', via = 'B';
    while (n > 0) {
        const unsigned long long middle = 1ull << (n - 1);
        if (k == middle) return string(1, from) + " " + string(1, to);
        if (k < middle) {
            char spare = via;
            via = to;
            to = spare;
        } else {
            k -= middle;
            char spare = via;
            via = from;
            from = spare;
        }
        --n;
    }
    return "";
}

// ---- 跑选手程序 ----

// 每个测试点 spawn 一次：把 stdin/stdout 接到测试点上再 exec 选手程序，
// 父进程用 waitpid(WNOHANG) 轮询来计时 —— 这是**逐测试点**的挂钟限制，
// 与旧 traditional 判题机逐点 spawn 的语义一致。选手提交的是完整程序
// （contestantOwnsMain: true），所以这里 exec 一个独立可执行文件。
//
// 超时用「已过时间 >= 限额」判定，而不是「已过时间 > 限额 + 余量」：宿主负载重时
// 轮询本身会晚返回，那种情况不该冤枉成超时。
struct CaseRun {
    bool ok;          // 正常退出
    bool timedOut;
    double ms;
};

static double msSince(const chrono::steady_clock::time_point &t0) {
    return chrono::duration<double, milli>(chrono::steady_clock::now() - t0).count();
}

static CaseRun run_one(const string &prog, const string &in, const string &out, int limitMs) {
    auto t0 = chrono::steady_clock::now();
    const pid_t pid = fork();
    if (pid < 0) { perror("fork"); exit(3); }
    if (pid == 0) {
        const int fi = open(in.c_str(), O_RDONLY);
        const int fo = open(out.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (fi < 0 || fo < 0) _exit(127);
        dup2(fi, 0);
        dup2(fo, 1);
        // exec 而不是调用函数：选手交的是完整程序，它自己负责 I/O 与退出。
        execl(prog.c_str(), prog.c_str(), (char *)nullptr);
        _exit(127);
    }
    int status = 0;
    for (;;) {
        const pid_t done = waitpid(pid, &status, WNOHANG);
        if (done == pid) break;
        if (done < 0) { if (errno == EINTR) continue; perror("waitpid"); exit(3); }
        if ((int)msSince(t0) >= limitMs) {
            kill(pid, SIGKILL);
            waitpid(pid, &status, 0);
            return {false, true, msSince(t0)};
        }
        usleep(500);
    }
    return {WIFEXITED(status) && WEXITSTATUS(status) == 0, false, msSince(t0)};
}

static string slurp(const string &path) {
    ifstream f(path);
    string s, t;
    while (f >> t) {
        if (!s.empty()) s += ' ';
        s += t;
    }
    return s;
}

static void emit(int score, const char *what) {
    const char *status = score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer";
    printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":100,\\"status\\":\\"%s\\",\\"message\\":\\"%s\\"}\\n",
           score, status, what);
    fflush(stdout);
}

int main(int argc, char **argv) {
    // argv[1] = 每个测试点的挂钟上限（毫秒）。判题机的 timeLimitMs 是整轮的兜底。
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <case_limit_ms>\\n", argv[0]);
        return 2;
    }
    const int caseLimitMs = atoi(argv[1]);

    // exec 要用绝对路径：子进程的 cwd 是 scratch 目录，但显式给全更稳。
    char cwd[4096];
    if (getcwd(cwd, sizeof cwd) == nullptr) { perror("getcwd"); return 3; }
    const string prog = string(cwd) + "/contestant";

    const vector<vector<Case>> subtasks = generate();
    const int points[3] = {30, 30, 40};

    int total = 0;
    int passed = 0, all = 0, timedOutCount = 0;
    for (const auto &s : subtasks) all += (int)s.size();

    string firstFail;
    double slowest = 0;
    for (int si = 0; si < (int)subtasks.size(); si++) {
        bool ok = true;
        for (const Case &c : subtasks[si]) {
            const string in = "case.in", out = "case.out";
            {
                FILE *f = fopen(in.c_str(), "w");
                if (!f) { perror("fopen case.in"); return 3; }
                fprintf(f, "%lld %llu\\n", c.n, c.k);
                fclose(f);
            }

            const CaseRun r = run_one(prog, in, out, caseLimitMs);
            if (r.ms > slowest) slowest = r.ms;

            string why;
            if (r.timedOut) {
                ok = false;
                timedOutCount += 1;
                why = "超时（限额 " + to_string(caseLimitMs) + " ms）";
            } else if (!r.ok) {
                ok = false;
                why = "非正常退出";
            } else {
                const string got = slurp(out);
                const string want = reference(c.n, c.k);
                if (got != want) {
                    ok = false;
                    why = "期望 " + want + "，得到 " + (got.empty() ? "(空)" : got);
                }
            }

            if (why.empty()) {
                passed += 1;
            } else if (firstFail.empty()) {
                firstFail = "n=" + to_string(c.n) + " k=" + to_string(c.k) + " " + why;
            }
        }
        if (ok) total += points[si];
    }

    if (total >= 100) {
        emit(100, "全部测试点通过");
    } else if (total > 0) {
        string msg = "通过 " + to_string(passed) + "/" + to_string(all) +
                     " 个测试点，共 " + to_string(total) + " 分";
        if (timedOutCount > 0) msg += "，其中 " + to_string(timedOutCount) + " 个超时";
        if (!firstFail.empty()) msg += "；首个错误：" + firstFail;
        emit(total, msg.c_str());
    } else {
        string msg = firstFail.empty() ? "没有测试点通过" : ("首个错误：" + firstFail);
        emit(0, msg.c_str());
    }
    return 0;
}
`;

export const problem = {
  slug: "hanoi-kth",
  title: "汉诺塔 · 第 k 步",
  maxScore: 100,
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
      // 选手提交完整程序：自己写 main、从 stdin 读、往 stdout 写。
      contestantOwnsMain: true,
      build: {
        target: "all",
        // 必须与 makefile 的产物名、run.argv 里的 ./xxx 三处一致。
        artifact: "hanoi-kth",
        wallMs: 60000,
        memoryMb: 2048,
        threads: 1,
      },
      // argv[1] 是**每个测试点**的挂钟上限，单位毫秒。它必须与题面声明的
      // <Constraints time="1 s"> 一致：旧 traditional 判题机也是逐点套 1000 ms。
      run: { argv: ["./hanoi-kth", "1000"] },
      result: { required: true },
      cases: [
        {
          name: "全部子任务",
          argv: ["./hanoi-kth", "1000"],
          // 驱动自己挨个 fork 出选手程序，单进程、单线程。
          threads: 1,
          // 驱动要跑 34 个测试点，每个 fork 一次。逐点限制由驱动内的
          // caseLimitMs 负责（1000 ms × 34 ≈ 34 s 是最坏情况的理论上限），
          // 这里的 timeLimitMs 只是整轮的兜底，必须不小于它——否则驱动还在
          // 逐点判超时就被判题机杀了，选手看到的是"评测中断"而不是超时。
          timeLimitMs: 40000,
          maxScore: 100,
        },
      ],
      seed: 1,
      // 与题面声明的 256 MB 一致。注意这是 RLIMIT_AS（每进程），驱动与 fork
      // 出来的选手是各自独立的进程，各自拿到这个预算——不是两者相加。
      memoryLimitMb: 256,
      stackLimitMb: 8,
    },
  },
  ui: {
    // 题目只收 C++：makefile 是按 C++ 写的。
    languages: ["cpp"],
    tags: ["递归"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
