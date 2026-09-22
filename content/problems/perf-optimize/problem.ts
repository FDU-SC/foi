import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * 性能优化题 · 矩阵乘法。
 *
 * 判定与计分都在下面的驱动里：驱动自己造 n×n 矩阵、把它写成输入文件，然后把
 * 内置的朴素基线与选手程序**各自作为独立进程**跑同样的输入（预热 1 次、计时
 * 3 次取最小），逐字节比对输出，最后按加速比给分。判题机不认识矩阵乘法，只
 * 负责铺文件、跑 make、读回一行 FOI_RESULT。
 *
 * 选手提交的是**完整程序**（自己写 main，读 stdin、往 stdout 输出矩阵），所以
 * `contestantOwnsMain` 为 true：驱动不会给选手文件补 main，也不会禁止它。
 * 基线与选手走完全一样的路径——编译成可执行文件、同样的输入输出方式、同样的
 * 计时方式——否则两者的耗时不可比。
 */

/**
 * 编译方式。两条硬约束：
 *
 *   1. **允许 AVX-512。** 用 -march=x86-64-v4 而不是 -mavx512f：后者只开基础
 *      指令集，_mm512_add_epi16 / _mm512_popcnt_epi64 这类会编译失败；v4 一次
 *      给全 f/bw/cd/dq/vl。它也比 -march=native 可复现，产物不绑具体 CPU 型号。
 *
 *   2. **不允许并行。** 链接命令里绝不出现 -pthread 与 -fopenmp，于是裸 pthread
 *      和 std::thread 都会在链接期失败；链接后再查一次动态符号表兜底。
 *
 * 三个可执行文件用同一套 flags 编译，包括基线——基线也跑 -march=x86-64-v4，
 * 否则题面承诺的「朴素实现约得 20 分」就不成立（基线被压低会虚增所有人的分数）。
 */
const MAKEFILE = `CXX      ?= g++
CXXFLAGS ?= -O3 -std=c++20 -march=x86-64-v4 -funroll-loops

# 多线程特征。std::thread 走的是 libstdc++ 的 _ZNSt6thread 系列修饰名，不会出现
# pthread_create，所以必须按修饰名匹配：只查 pthread_create 会整整齐齐地漏掉它。
THREAD_MARKS = ^(_ZNSt6thread|_ZNSt18condition_variable|_ZNSt5mutex|_ZSt5async|_ZNSt7promise|pthread_create|GOMP_|omp_get_|__kmpc_)

# 一整条 recipe 交给同一个 shell。默认每条 recipe 行都是一个独立 shell，那样
# 带 if/|| 的多行命令必须用反斜杠续行，很容易写错且难读。
.ONESHELL:

.PHONY: all clean check-single-thread

all: perf-optimize

contestant: contestant.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<

# 前置条件里混了 phony 目标 check-single-thread，所以这里显式写文件名，
# 不能用 $^——那会把 phony 目标也当成目标文件交给 g++。
# 基线不需要单独的可执行文件：驱动本体的 --baseline 模式就是基线。
perf-optimize: driver.cpp naive.cpp check-single-thread
	$(CXX) $(CXXFLAGS) -o $@ driver.cpp naive.cpp

# 不允许并行。链接命令里没有 -pthread / -fopenmp，所以裸 pthread 与 std::thread
# 本来就链接不过；这里再查一次选手产物的动态符号表，兜住由库间接引入的线程。
check-single-thread: contestant
	@if nm -D --undefined-only contestant 2>/dev/null | awk '{print $$NF}' | grep -qE '$(THREAD_MARKS)'; then
	  echo "本题不允许使用多线程：你的程序引用了以下线程符号。" >&2
	  nm -D --undefined-only contestant | awk '{print $$NF}' | grep -E '$(THREAD_MARKS)' | sed 's/^/  引用 /' >&2
	  echo "向量化（AVX-512）是允许的，请改为单线程实现。" >&2
	  exit 1
	fi

clean:
	rm -f perf-optimize naive contestant
`;

/**
 * 题面公布的朴素实现，只提供函数、不含 main。
 *
 * 它是本题唯一的"标准答案"来源：driver 用它算出 expect.txt，基线可执行文件
 * 也调它（`./perf-optimize --baseline`）。改它等于改计分。
 */
const NAIVE = `#include <bits/stdc++.h>

using namespace std;

void naive(vector<vector<long long>> &a, vector<vector<long long>> &b, vector<vector<long long>> &c) {
    int n = a.size();
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            for (int k = 0; k < n; k++) c[i][j] += a[i][k] * b[k][j];
}
`;

/**
 * 评测驱动。命令行：<n> <seed> <base>
 *
 *   score = 正确 ? min(100, floor(base × 基线耗时 / 选手耗时)) : 0
 *
 * base = 20 时，朴素实现原样提交得 20 分，5 倍加速满分。base 由配置传进来，
 * 将来调整分数只改配置，不用动驱动。
 *
 * 基线与选手都作为子进程运行：重定向 stdin/stdout、waitpid 取状态、用
 * steady_clock 测挂钟。驱动自身不跑三重循环，只造数据与比对。
 */
const DRIVER = `#include <bits/stdc++.h>

#include <fcntl.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace std;

// 来自 naive.cpp：expect.txt 由它算出，基线的耗时也由它决定。
void naive(vector<vector<long long>> &a, vector<vector<long long>> &b, vector<vector<long long>> &c);

static void gen_input(int n, unsigned seed, const string &path) {
    mt19937 rng(seed);
    FILE *f = fopen(path.c_str(), "w");
    if (!f) { perror("fopen input"); exit(3); }
    fprintf(f, "%d\\n", n);
    for (int m = 0; m < 2; m++)
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++) fprintf(f, "%d ", (int)(rng() % 100));
    fclose(f);
}

static void write_expect(int n, unsigned seed, const string &path) {
    const int B = 32;
    vector<long long> a((size_t)n * n), b((size_t)n * n), c((size_t)n * n, 0);
    mt19937 rng(seed);
    for (auto &x : a) x = rng() % 100;
    for (auto &x : b) x = rng() % 100;
    // 4 个 [0,99] 的乘积最大 96059601，32 位精确；n=512 的累加和远不到 long long 上限。
    // 三个方向都要夹住上界：n 不整除 B 时 min 才有意义（n=512 恰好整除，但不能依赖它）。
    for (int i0 = 0; i0 < n; i0 += B)
        for (int k0 = 0; k0 < n; k0 += B)
            for (int j0 = 0; j0 < n; j0 += B)
                for (int i = i0; i < min(i0 + B, n); i++)
                    for (int k = k0; k < min(k0 + B, n); k++) {
                        long long aik = a[(size_t)i * n + k];
                        for (int j = j0; j < min(j0 + B, n); j++)
                            c[(size_t)i * n + j] += aik * b[(size_t)k * n + j];
                    }
    FILE *f = fopen(path.c_str(), "w");
    if (!f) { perror("fopen expect"); exit(3); }
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            if (j) fputc(' ', f);
            fprintf(f, "%lld", c[(size_t)i * n + j]);
        }
        fputc('\\n', f);
    }
    fclose(f);
}

static string slurp(const string &path) {
    ifstream f(path, ios::binary);
    return string((istreambuf_iterator<char>(f)), istreambuf_iterator<char>());
}

// 把 stdout 重定向到 out，再 execvp。argv 以 nullptr 结尾。成功不返回。
static void child_exec(const string &prog, const string &in, const string &out,
                       const char *const *args) {
    int fi = open(in.c_str(), O_RDONLY);
    int fo = open(out.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fi < 0 || fo < 0) _exit(127);
    dup2(fi, 0);
    dup2(fo, 1);
    execv(prog.c_str(), const_cast<char *const *>(args));
    _exit(127);
}

struct Attempt {
    bool ok;
    double ms;
};

static Attempt run_once(const char *const *args, const string &in, const string &out) {
    auto t0 = chrono::steady_clock::now();
    pid_t pid = fork();
    if (pid < 0) { perror("fork"); exit(3); }
    if (pid == 0) child_exec(args[0], in, out, args);
    int status = 0;
    waitpid(pid, &status, 0);
    auto t1 = chrono::steady_clock::now();
    double ms = chrono::duration<double, milli>(t1 - t0).count();
    bool ok = WIFEXITED(status) && WEXITSTATUS(status) == 0;
    return {ok, ms};
}

// 预热 1 次，然后计时 3 次取最小。返回 false 表示某次运行非正常退出。
static bool best_of_3(const char *const *args, const string &in, const string &out, double &best_ms) {
    for (int i = 0; i < 4; i++) {
        Attempt r = run_once(args, in, out);
        if (!r.ok) return false;
        if (i > 0 && (best_ms < 0 || r.ms < best_ms)) best_ms = r.ms;
    }
    return true;
}

static void emit(int score, const char *what, double time_ms, double base_ms) {
    const char *status = score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer";
    printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":100,\\"status\\":\\"%s\\","
           "\\"message\\":\\"%s；用时 %.2f ms，基线 %.2f ms，加速 %.2fx\\"}\\n",
           score, status, what, time_ms, base_ms, base_ms / time_ms);
    fflush(stdout);
}

static int baseline_mode() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 1;
    vector<vector<long long>> a(n, vector<long long>(n)), b(n, vector<long long>(n));
    vector<vector<long long>> c(n, vector<long long>(n));
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++) cin >> a[i][j];
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++) cin >> b[i][j];
    naive(a, b, c);
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            if (j) cout << ' ';
            cout << c[i][j];
        }
        cout << '\\n';
    }
    return 0;
}

int main(int argc, char *argv[]) {
    if (argc == 2 && string(argv[1]) == "--baseline") return baseline_mode();
    if (argc != 4) {
        fprintf(stderr, "Usage: %s <n> <seed> <base>\\n", argv[0]);
        return 2;
    }
    int n = atoi(argv[1]);
    unsigned seed = (unsigned)strtoul(argv[2], nullptr, 10);
    int base = atoi(argv[3]);

    const string in = "input.txt", expect = "expect.txt";
    const string out_naive = "naive.out", out_contestant = "contestant.out";

    gen_input(n, seed, in);
    write_expect(n, seed, expect);

    double t_naive = -1, t_contestant = -1;
    const char *baseline_argv[] = {"./perf-optimize", "--baseline", nullptr};
    const char *contestant_argv[] = {"./contestant", nullptr};
    if (!best_of_3(baseline_argv, in, out_naive, t_naive)) {
        emit(0, "基线程序运行失败，请报告出题人", 0, 0);
        return 0;
    }
    if (!best_of_3(contestant_argv, in, out_contestant, t_contestant)) {
        emit(0, "你的程序非正常退出（崩溃或被信号终止）", 0, t_naive);
        return 0;
    }
    if (slurp(out_naive) != slurp(expect)) {
        emit(0, "基线输出与参考解不一致，请报告出题人", 0, 0);
        return 0;
    }
    if (slurp(out_contestant) != slurp(expect)) {
        emit(0, "输出与参考解不一致（评测机逐字节比对）", t_contestant, t_naive);
        return 0;
    }

    int score = (int)((double)base * t_naive / t_contestant);
    if (score > 100) score = 100;
    if (score < 0) score = 0;
    emit(score, "输出正确", t_contestant, t_naive);
    return 0;
}
`;

/** 命令行参数：n、seed、base。base 决定题面公布的计分公式系数。 */
const N = 512;
const SEED = 1;
const BASE = 20;

export const problem = {
  slug: "perf-optimize",
  title: "性能优化题示例 · 矩阵乘法",
  maxScore: 100,
  backend: {
    id: "interactive",
    config: {
      files: [
        { path: "makefile", content: MAKEFILE },
        { path: "naive.cpp", content: NAIVE },
        { path: "driver.cpp", content: DRIVER },
        { path: "contestant.cpp", content: "(由提交内容覆盖)" },
      ],
      makefile: "makefile",
      contestant: "contestant.cpp",
      // 选手提交完整程序（自己写 main，读 stdin、写 stdout）。
      contestantOwnsMain: true,
      build: {
        target: "all",
        // 必须与 makefile 的产物名、run.argv 里的 ./xxx 三处一致，否则判题机
        // 会在 make 成功后报「makefile 与 config 对不上」。
        artifact: "perf-optimize",
        // g++ 要展开 <bits/stdc++.h> 并编三份源码，给足编译预算。
        wallMs: 120000,
        memoryMb: 2048,
        // 只影响编译期的 CPU 时间预算；全题强制单线程所以填 1。
        threads: 1,
      },
      // 判题机只看这条命令的退出状态与 FOI_RESULT 行；真正的计时在驱动内部。
      run: { argv: ["./perf-optimize", String(N), String(SEED), String(BASE)] },
      result: { required: true },
      cases: [
        {
          name: `n=${N}`,
          argv: ["./perf-optimize", String(N), String(SEED), String(BASE)],
          // 单线程：填 1 才会按 1 核算 CPU 时间预算。
          threads: 1,
          // 驱动要跑 4 次基线（预热 1 次 + 计时 3 次）加 4 次选手程序。实测三个
          // 可执行文件各约 70 ms、整轮约 0.5 秒，5 秒足够拦住真正的超时提交。
          timeLimitMs: 5000,
          maxScore: 100,
        },
      ],
      // 这道题没有隐藏值，seed 只是通过配置校验。随机性来自 argv 里的 seed。
      seed: 1,
      // 驱动与它的子进程同时存活，而 RLIMIT_AS 是按进程算的：驱动本身要放
      // 三份 n×n 的矩阵（约 6 MB），子进程还要各自再放一份。给足 1 GB。
      memoryLimitMb: 1024,
      stackLimitMb: 8,
    },
  },
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的优化代码（完整程序，读入矩阵并输出乘积）",
    tags: ["访存", "性能", "SIMD"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
