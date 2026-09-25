import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * MPI 优化 · 分布式 π。
 *
 * 判定与计分都在下面的驱动里：驱动把同一个输入交给两个 MPI 程序各自跑一遍
 * ——题面公布的「祖传实现」基线，和选手的程序——都通过 `mpirun -np N` 拉起，
 * 然后与驱动内部算出的参考值做容差比对，最后按加速比给分。判题机不认识 MPI，
 * 只负责铺文件、跑 make、读回一行 FOI_RESULT。
 *
 * 为什么驱动要自己调 mpirun：判题机每个测试点只执行一条命令，而 MPI 必须由
 * `mpirun` 统一拉起 N 个互相通信的进程。所以 `run.argv` 指向的是驱动，选手的
 * MPI 程序是驱动的子进程。
 *
 * 选手提交**完整程序**（自己写 main、自己 MPI_Init），所以 contestantOwnsMain
 * 为 true。
 */

/**
 * 编译方式。
 *
 * 用 mpicxx 而不是 g++：它只是 g++ 外面加一层，负责补上 mpi.h 的 include 路径
 * 并链接 libmpi，真正的编译仍然是同一个 g++。
 *
 * 一个 MPI rank 内部**不允许**再开线程：并行只能来自 MPI rank。链接命令里没有
 * -fopenmp / -pthread，所以 OpenMP 与 std::thread 都会在链接期失败；链接后再
 * 查一次动态符号表兜底。
 */
const MAKEFILE = `MPICXX   ?= mpicxx
CXXFLAGS ?= -O3 -std=c++20 -march=x86-64-v4 -funroll-loops

# 多线程特征。std::thread 走的是 libstdc++ 的 _ZNSt6thread 系列修饰名，不会出现
# pthread_create，所以必须按修饰名匹配：只查 pthread_create 会整整齐齐地漏掉它。
THREAD_MARKS = ^(_ZNSt6thread|_ZNSt18condition_variable|_ZNSt5mutex|_ZSt5async|_ZNSt7promise|pthread_create|GOMP_|omp_get_|__kmpc_)

# 一整条 recipe 交给同一个 shell。默认每条 recipe 行都是一个独立 shell，那样
# 带 if/|| 的多行命令必须用反斜杠续行，很容易写错且难读。
.ONESHELL:

.PHONY: all clean check-single-thread

all: driver

baseline: baseline.cpp
	$(MPICXX) $(CXXFLAGS) -o $@ $<

contestant: contestant.cpp
	$(MPICXX) $(CXXFLAGS) -o $@ $<

# 前置条件里混了 phony 目标 check-single-thread，所以这里显式写文件名，
# 不能用 $^——那会把 phony 目标也当成目标文件交给 mpicxx。
driver: driver.cpp baseline check-single-thread
	$(MPICXX) $(CXXFLAGS) -o $@ driver.cpp

# 每个 rank 内部必须是单线程，并行只能来自 MPI rank。
check-single-thread: contestant
	@if nm -D --undefined-only contestant 2>/dev/null | awk '{print $$NF}' | grep -qE '$(THREAD_MARKS)'; then
	  echo "每个 rank 内部不允许再开线程（没有 -fopenmp / -pthread），并行只能来自 MPI rank。" >&2
	  nm -D --undefined-only contestant | awk '{print $$NF}' | grep -E '$(THREAD_MARKS)' | sed 's/^/  引用 /' >&2
	  exit 1
	fi

clean:
	rm -f driver baseline contestant
`;

/**
 * 题面公布的「祖传实现」：正确但低效——每个进程算完局部和后，用点对点
 * Send/Recv 逐块传给 rank 0 串行累加。
 *
 * 它同时是基线的计时依据与容差比对的参照物：驱动先跑它、拿它的输出当期望值，
 * 再跑选手的程序做比对。改它等于改计分。
 */
const BASELINE = `#include <mpi.h>
#include <bits/stdc++.h>
using namespace std;
int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);
    int rank, size;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);
    long long n = 0;
    if (rank == 0) { if (!(cin >> n)) n = 200000000LL; }
    MPI_Bcast(&n, 1, MPI_LONG_LONG, 0, MPI_COMM_WORLD);

    double h = 1.0 / n, local = 0.0;
    for (long long i = rank; i < n; i += size) {
        double x = (i + 0.5) * h;
        local += 4.0 / (1.0 + x * x);
    }

    if (rank == 0) {
        double total = local;
        for (int src = 1; src < size; src++) {
            double part;
            MPI_Recv(&part, 1, MPI_DOUBLE, src, 0, MPI_COMM_WORLD, MPI_STATUS_IGNORE);
            total += part;
        }
        cout << fixed << setprecision(10) << total * h << endl;
    } else {
        MPI_Send(&local, 1, MPI_DOUBLE, 0, 0, MPI_COMM_WORLD);
    }

    MPI_Finalize();
    return 0;
}
`;

/**
 * 评测驱动。命令行：<n> <np> <base> <warmup> <timed>
 *
 *   score = 正确 ? min(100, floor(base × 基线耗时 / 选手耗时)) : 0
 *
 * base = 50 时，祖传实现原样提交得 50 分。计时口径是**整个 MPI 程序的挂钟**：
 * 基线取 warmup 次热身后的 timed 次最小值，选手程序跑一次。
 */
const DRIVER = `#include <bits/stdc++.h>

#include <fcntl.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace std;

// 把 stdout 重定向到 out，再 execv。argv 以 nullptr 结尾。成功不返回。
static void child_exec(const char *const *args, const string &in, const string &out) {
    int fi = open(in.c_str(), O_RDONLY);
    int fo = open(out.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fi < 0 || fo < 0) _exit(127);
    dup2(fi, 0);
    dup2(fo, 1);
    execv(args[0], const_cast<char *const *>(args));
    _exit(127);
}

struct Attempt {
    bool ok;
    double ms;
    int code;
};

static Attempt run_once(const char *const *args, const string &in, const string &out) {
    auto t0 = chrono::steady_clock::now();
    pid_t pid = fork();
    if (pid < 0) { perror("fork"); exit(3); }
    if (pid == 0) child_exec(args, in, out);
    int status = 0;
    waitpid(pid, &status, 0);
    auto t1 = chrono::steady_clock::now();
    double ms = chrono::duration<double, milli>(t1 - t0).count();
    bool ok = WIFEXITED(status) && WEXITSTATUS(status) == 0;
    int code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    return {ok, ms, code};
}

static string slurp(const string &path) {
    ifstream f(path, ios::binary);
    return string((istreambuf_iterator<char>(f)), istreambuf_iterator<char>());
}

// 用与基线相同的 rank 切分方式串行算一遍参考值：各 rank 的 strided 局部和相加。
static double reference_pi(long long n, int np) {
    const double h = 1.0 / (double)n;
    double total = 0.0;
    for (int r = 0; r < np; r++) {
        double local = 0.0;
        for (long long i = r; i < n; i += np) {
            const double x = ((double)i + 0.5) * h;
            local += 4.0 / (1.0 + x * x);
        }
        total += local;
    }
    return total * h;
}

static void emit(int score, const char *what, double time_ms, double base_ms) {
    const char *status = score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer";
    printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":100,\\"status\\":\\"%s\\",\\"message\\":\\"%s；用时 %.1f ms，基线 %.1f ms，加速 %.2fx\\"}\\n",
           score, status, what, time_ms, base_ms, base_ms / time_ms);
    fflush(stdout);
}

int main(int argc, char *argv[]) {
    if (argc != 6) {
        fprintf(stderr, "Usage: %s <n> <np> <base> <warmup> <timed>\\n", argv[0]);
        return 2;
    }
    const long long n = atoll(argv[1]);
    const int np = atoi(argv[2]);
    const int base = atoi(argv[3]);
    const int warmup = atoi(argv[4]);
    const int timed = atoi(argv[5]);

    // 输入里只有 n，而且只有 rank 0 会读它。
    FILE *f = fopen("input.txt", "w");
    if (!f) { perror("fopen input"); exit(3); }
    fprintf(f, "%lld\\n", n);
    fclose(f);

    const string in = "input.txt";
    const string out_base = "baseline.out", out_cont = "contestant.out";

    // --oversubscribe 是必需的：OpenMPI 在容器里只认出 8 个槽位（尽管 cgroup
    // 给的是 16 核），不放开的话 np 稍大就直接拒绝启动。--bind-to none 避免把
    // rank 钉在具体核心上，否则计时抖动会很大。
    const string npstr = to_string(np);

    // mpirun 不按当前目录解析相对路径，会报 could not access or execute ./baseline。
    // 用 getcwd 拼成绝对路径交给它。
    char cwd[4096];
    if (getcwd(cwd, sizeof cwd) == nullptr) { perror("getcwd"); exit(3); }
    const string path_base = string(cwd) + "/baseline";
    const string path_cont = string(cwd) + "/contestant";
    const char *base_args[] = {"/usr/bin/mpirun", "--oversubscribe", "--bind-to", "none",
                               "-np", npstr.c_str(), path_base.c_str(), nullptr};
    const char *cont_args[] = {"/usr/bin/mpirun", "--oversubscribe", "--bind-to", "none",
                               "-np", npstr.c_str(), path_cont.c_str(), nullptr};

    // 基线：跑 warmup 次热身后，取 timed 次的最小值。
    double t_base = -1;
    for (int i = 0; i < warmup + timed; i++) {
        const Attempt r = run_once(base_args, in, out_base);
        if (!r.ok) {
            emit(0, "基线程序运行失败，请报告出题人", 0, 0);
            return 0;
        }
        if (i >= warmup && (t_base < 0 || r.ms < t_base)) t_base = r.ms;
    }

    const Attempt c = run_once(cont_args, in, out_cont);
    if (!c.ok) {
        emit(0, c.code == 127 ? "你的程序没有产出可执行文件，或 mpirun 启动失败"
                              : "你的程序非正常退出（崩溃或被信号终止）",
             0, t_base);
        return 0;
    }

    const double ref = reference_pi(n, np);
    const string raw = slurp(out_cont);
    double got = 0.0;
    {
        stringstream ss(raw);
        if (!(ss >> got)) {
            emit(0, "你的程序没有输出任何数字", c.ms, t_base);
            return 0;
        }
    }
    const double rel = fabs(ref - got) / fabs(ref);
    if (rel > 1e-5) {
        char buf[256];
        snprintf(buf, sizeof buf,
                 "输出与参考解不一致（相对误差 %.3g，容差 1e-5；期望 %.10f，得到 %.10f）",
                 rel, ref, got);
        emit(0, buf, c.ms, t_base);
        return 0;
    }

    int score = (int)((double)base * t_base / c.ms);
    if (score > 100) score = 100;
    if (score < 0) score = 0;
    emit(score, "输出正确", c.ms, t_base);
    return 0;
}
`;

/** 命令行参数：n、MPI rank 数、base、预热次数、计时次数。 */
const N = 200000000;
const NP = 4;
const BASE = 50;
const WARMUP = 1;
const TIMED = 3;

/** 驱动与 cases 共用的 argv。 */
const ARGV = ["./driver", String(N), String(NP), String(BASE), String(WARMUP), String(TIMED)];

export const problem = {
  slug: "mpi-pi",
  title: "MPI 优化 · 分布式 π",
  maxScore: 100,
  backend: {
    id: "interactive",
    config: {
      files: [
        { path: "makefile", content: MAKEFILE },
        { path: "baseline.cpp", content: BASELINE },
        { path: "driver.cpp", content: DRIVER },
        { path: "contestant.cpp", content: "(由提交内容覆盖)" },
      ],
      makefile: "makefile",
      contestant: "contestant.cpp",
      // 选手提交完整 MPI 程序（自己写 main、自己 MPI_Init）。
      contestantOwnsMain: true,
      build: {
        target: "all",
        // 必须与 makefile 的产物名、run.argv 里的 ./xxx 三处一致，否则判题机
        // 会在 make 成功后报「makefile 与 config 对不上」。
        artifact: "driver",
        wallMs: 120000,
        memoryMb: 2048,
        // 编译期的 CPU 时间预算；编译是单进程，所以填 1。
        threads: 1,
      },
      run: { argv: ARGV },
      result: { required: true },
      cases: [
        {
          name: `n=${N} np=${NP}`,
          argv: ARGV,
          // 驱动自己 fork 出 mpirun，每个 rank 是独立进程、各自消耗 CPU 时间，
          // 所以 CPU 时间预算必须按 rank 数放大；填 1 会让进程在挂钟到期前
          // 就被 RLIMIT_CPU 打成 SIGXCPU。
          threads: NP,
          // 实测基线约 0.3 秒（含 MPI 启动），驱动总共跑 1+3 次基线加 1 次选手
          // 程序。30 秒留足余量，同时仍能拦住真正的超时提交。
          timeLimitMs: 30000,
          maxScore: 100,
        },
      ],
      // 这道题没有隐藏值，seed 只是通过配置校验。
      seed: 1,
      // 地址空间按进程算（RLIMIT_AS 是每进程的）：驱动 512 MB 之外，每个 rank
      // 还要给 threads × stack 留余量，OpenMPI 自己也要预留映射。
      memoryLimitMb: 512,
      stackLimitMb: 8,
    },
  },
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的 MPI 优化代码（完整程序，读入 n 并输出 π 近似）",
    tags: ["性能优化", "MPI", "并行"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
