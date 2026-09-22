import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * OpenMP 优化 · π 的数值积分。
 *
 * 评测跑在 `interactive` 队列上：判定与计分都在下面的驱动里，平台与判题机
 * 都不认识数值积分。驱动做三件事：
 *
 *   1. 把选手程序（完整程序，读 n、输出 π）当**子进程**跑并自己计时。用沙箱的
 *      挂钟不行——那会把进程启动和参考解的钱都算到选手头上。
 *   2. 用同一 makefile 编出的**串行参考**做分母，两者在完全相同的条件下计时。
 *      每次提交都重测：宿主有负载时固定的分母会系统性偏。
 *   3. 容差 1e-6 比对 π，再按加速比给分：
 *
 *        score = min(base + perf, base + perf × (串行耗时 / 你的耗时 - 1))
 *
 *      即**串行提交得 base（约 50 分），两倍加速得满分**，与题面一致。
 *
 * 判题机侧没有这道题的副本：驱动只存在于这份 config 里，判题机只负责铺文件、
 * 跑 make、执行、读回 `FOI_RESULT`。
 */
const DRIVER = `// Harness for the OpenMP pi integration problem.
//
// The contestant submits a complete program, which is the upstream interface, so
// the driver runs it as a child process and times it itself. That matters: the
// judge's wall clock would charge the contestant for process startup and for the
// reference solution, neither of which is their doing.
//
// Baseline is a sibling binary built from the same makefile, so it is timed under
// exactly the same conditions. Both are re-measured per submission rather than
// baked in: a host under load would otherwise produce systematically wrong
// ratios.
//
// Usage: ./prog <n> <base> <perf> <seed>
//   seed is accepted and ignored so the argv shape matches the other drivers;
//   this problem has no random input.
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace {

/** Exact to double precision; both reference programs approximate it. */
const double PI = 3.14159265358979323846;

/** Relative error the upstream statement allows between the two programs. */
const double TOLERANCE = 1e-6;

/** Points for a 2x speedup, i.e. \`floor(50 * baseline / time)\`. */
const int PIVOT = 50;

std::string readAll(int fd) {
    std::string out;
    char buf[4096];
    ssize_t got;
    while ((got = read(fd, buf, sizeof buf)) > 0) out.append(buf, (size_t)got);
    return out;
}

struct Run {
    bool ok;
    double value;
    double ms;
    int status;
};

/**
 * Runs \`argv\` with \`n\` on stdin and measures only its lifetime.
 *
 * The clock starts after the fork and stops when the child closes stdout, so it
 * covers the image load and the program itself but none of our own work.
 */
Run runChild(const std::string &path, const std::string &input) {
    int inPipe[2], outPipe[2];
    if (pipe(inPipe) != 0 || pipe(outPipe) != 0) return {false, 0, 0, -1};

    struct timespec t0, t1;

    const pid_t pid = fork();
    if (pid < 0) return {false, 0, 0, -1};

    if (pid == 0) {
        dup2(inPipe[0], STDIN_FILENO);
        dup2(outPipe[1], STDOUT_FILENO);
        close(inPipe[0]);
        close(inPipe[1]);
        close(outPipe[0]);
        close(outPipe[1]);

        std::vector<char *> cargv;
        cargv.push_back(const_cast<char *>(path.c_str()));
        cargv.push_back(nullptr);
        execv(cargv[0], cargv.data());
        _exit(127);
    }

    close(inPipe[0]);
    close(outPipe[1]);

    clock_gettime(CLOCK_MONOTONIC, &t0);

    size_t written = 0;
    while (written < input.size()) {
        const ssize_t put =
            write(inPipe[1], input.data() + written, input.size() - written);
        if (put <= 0) break;
        written += (size_t)put;
    }
    close(inPipe[1]);

    const std::string out = readAll(outPipe[0]);
    close(outPipe[0]);

    clock_gettime(CLOCK_MONOTONIC, &t1);

    int status = 0;
    waitpid(pid, &status, 0);

    const double ms = ((double)t1.tv_sec - (double)t0.tv_sec) * 1000.0 +
                      ((double)t1.tv_nsec - (double)t0.tv_nsec) / 1e6;

    double value = 0.0;
    const bool parsed = sscanf(out.c_str(), "%lf", &value) == 1;
    const bool exited = WIFEXITED(status) && WEXITSTATUS(status) == 0;

    return {parsed && exited, value, ms, status};
}

bool closeEnough(double got, double want) {
    const double scale = fabs(want) > 0 ? fabs(want) : 1.0;
    return fabs(got - want) / scale <= TOLERANCE;
}

}  // namespace

int main(int argc, char **argv) {
    if (argc != 5) {
        fprintf(stderr, "usage: %s <n> <base> <perf> <seed>\\n", argv[0]);
        return 2;
    }

    const long long n = strtoll(argv[1], nullptr, 10);
    const int base = atoi(argv[2]);
    const int perf = atoi(argv[3]);
    const int maxScore = base + perf;

    char input[64];
    snprintf(input, sizeof input, "%lld\\n", n);

    const Run mine = runChild("./contestant", input);
    if (!mine.ok) {
        printf("FOI_RESULT {\\"score\\":0,\\"maxScore\\":%d,\\"status\\":\\"runtime_error\\","
               "\\"message\\":\\"你的程序没有正常结束或没有输出一个浮点数（退出状态 %d）\\"}\\n",
               maxScore, mine.status);
        return 0;
    }
    if (!closeEnough(mine.value, PI)) {
        printf("FOI_RESULT {\\"score\\":0,\\"maxScore\\":%d,\\"status\\":\\"wrong_answer\\","
               "\\"message\\":\\"输出 %.10f，与 pi 的相对误差 %.3g，超过 1e-6\\"}\\n",
               maxScore, mine.value, fabs(mine.value - PI) / PI);
        return 0;
    }

    const Run baseline = runChild("./baseline", input);
    if (!baseline.ok) {
        // The reference failing is the problem's fault, not the contestant's, so
        // exit non-zero: the judge turns that into a disruption rather than a
        // verdict against the submission.
        fprintf(stderr, "baseline 未能正常运行（退出状态 %d）\\n", baseline.status);
        return 1;
    }

    // Scoring, matching what the statement promises:
    //
    //   serial submission        -> base            (about 50)
    //   twice as fast as serial  -> base + perf     (full marks)
    //
    // So each 1.0x of speedup is worth \`perf\`, capped at the full score.
    const double speedup = baseline.ms / (mine.ms > 0 ? mine.ms : baseline.ms);
    const int score =
        (int)fmin((double)maxScore, floor((double)base + (double)perf * (speedup - 1.0)));

    printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":%d,\\"status\\":\\"%s\\","
           "\\"message\\":\\"n=%lld，你 %.1f ms，串行参考 %.1f ms，加速比 %.2fx\\"}\\n",
           score, maxScore, score >= maxScore ? "accepted" : "partial", n, mine.ms,
           baseline.ms, speedup);
    return 0;
}
`;

const BASELINE = `// The serial reference the contestant is scored against, and the one the
// statement shows. A separate translation unit because the driver times it as a
// child process, exactly like a submission.
//
// Reads n from stdin so it exercises the same path a contestant program written
// against the statement does.
#include <cstdio>

int main() {
    long long n = 0;
    if (scanf("%lld", &n) != 1 || n <= 0) return 1;

    const double h = 1.0 / (double)n;
    double sum = 0.0;
    for (long long i = 0; i < n; ++i) {
        const double x = ((double)i + 0.5) * h;
        sum += 4.0 / (1.0 + x * x);
    }
    printf("%.10f\\n", sum * h);
    return 0;
}
`;

const MAKEFILE = `CXX      ?= g++
CXXFLAGS ?= -O3 -std=c++17 -fopenmp

all: driver contestant baseline

contestant: contestant.cpp
	$(CXX) $(CXXFLAGS) -o $@ $^

# The reference is built with the flags the statement quotes for it, so the ratio
# the contestant is scored on starts from the efficiency the problem promised
# rather than from whatever the judge defaults to.
baseline: baseline.cpp
	$(CXX) -O2 -std=c++17 -o $@ $^

driver: driver.cpp
	$(CXX) -O2 -std=c++17 -o $@ $^

clean:
	rm -f driver contestant baseline
`;

export const problem = {
  slug: "openmp-pi",
  title: "OpenMP 优化 · π 的数值积分",
  maxScore: 100,
  backend: {
    id: "interactive",
    config: {
      files: [
        { path: "makefile", content: MAKEFILE },
        { path: "driver.cpp", content: DRIVER },
        { path: "baseline.cpp", content: BASELINE },
        { path: "contestant.cpp", content: "(由提交内容覆盖)" },
      ],
      makefile: "makefile",
      contestant: "contestant.cpp",
      // 选手交的是完整程序，驱动以子进程方式运行它，而不是链接进驱动。
      // 所以这里不能禁止 main()——那正好与 SSSP 那道题相反。
      contestantOwnsMain: true,
      build: {
        target: "all",
        artifact: "driver",
        wallMs: 120000,
        memoryMb: 2048,
        threads: 16,
      },
      // 判题机只看这条命令的退出状态和 FOI_RESULT 行；真正的计时在驱动内部。
      // 后四个参数是 n、base、perf、seed。
      run: { argv: ["./driver", "1000000000", "50", "50", "1"] },
      result: { required: true },
      cases: [
        {
          name: "n = 10^9",
          argv: ["./driver", "1000000000", "50", "50", "1"],
          // 驱动会拉起一个 16 线程的子进程，CPU 预算要按它算。
          threads: 16,
          timeLimitMs: 120000,
          maxScore: 100,
        },
      ],
      // 这道题没有隐藏值，seed 只是通过校验。
      seed: 1,
      memoryLimitMb: 1024,
      stackLimitMb: 8,
    },
  },
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的 OpenMP 优化代码（完整程序，读入 n 并输出 π 近似）",
    tags: ["性能优化", "OpenMP", "并行"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
