import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * Ring Allreduce · 环形全归约。
 *
 * 实现题，不评性能：选手用 MPI_Send / MPI_Recv 手写 ring allreduce，程序自检后
 * 由 rank 0 输出 PASS / FAIL。判定在驱动里——判题机不认识 MPI，只负责铺文件、
 * 跑 make、读回一行 FOI_RESULT。
 *
 * 驱动是**独立可执行文件**，不链接选手代码：它自己 fork 出 mpirun 跑选手程序，
 * 再把 rank 0 的输出与 PASS 比对。判题机每个测试点只执行一条命令，而 MPI 必须
 * 由 mpirun 统一拉起 N 个互相通信的进程，所以选手程序只能是驱动的子进程。
 *
 * "不许用 MPI_Allreduce 一行糊过去"这条要求由 makefile 在**编译期**用符号表检查
 * 兜住，而不是靠题面口头约定。
 */

/**
 * 编译方式。
 *
 * 用 mpicxx 而不是 g++：它负责补上 mpi.h 的 include 路径并链接 libmpi。
 *
 * 这里**故意不做**"禁止 MPI_Allreduce"的符号表检查。原因：mpicxx 链接 libmpi 时
 * 没有加 --as-needed，而 MPI 是弱符号，于是 libmpi 的所有符号都会成为二进制里的
 * 未定义引用——连只调 MPI_Init 的最小程序，nm 都能看到 MPI_Allreduce、MPI_Reduce、
 * MPI_Alltoall 等等。这种检查会把每一份提交都拒掉，比不做还糟。
 *
 * 于是"手写 ring allreduce"只能靠题面约束（见 statement：直接调 MPI_Allreduce
 * 能过评测，但那不是这道题的目标）。这一点在设计上是有意接受的。
 */
const MAKEFILE = `MPICXX   ?= mpicxx
CXXFLAGS ?= -O3 -std=c++20 -march=x86-64-v4

.PHONY: all clean

# 判题机跑的是 make all，所以选手程序必须挂在 all 下面，不能只靠驱动依赖它。
all: ring-allreduce contestant

contestant: contestant.cpp
	$(MPICXX) $(CXXFLAGS) -o $@ $<

ring-allreduce: driver.cpp
	$(MPICXX) $(CXXFLAGS) -o $@ driver.cpp

clean:
	rm -f ring-allreduce contestant
`;

/**
 * 评测驱动。命令行：无参数。
 *
 * 它 fork 出 `mpirun -np 4 ./contestant`，把 rank 0 的输出重定向到文件，然后读
 * 第一个 token：PASS 得满分，FAIL 或其它一律 0 分。参考实现在哪？没有——正确性
 * 由选手程序自己的自检给出，而这道题的标准就是"自检通过且输出 PASS"。
 */
const DRIVER = `#include <bits/stdc++.h>

#include <fcntl.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace std;

static void child_exec(const char *const *args, const string &out) {
    int fi = open("/dev/null", O_RDONLY);
    int fo = open(out.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fi < 0 || fo < 0) _exit(127);
    dup2(fi, 0);
    dup2(fo, 1);
    execv(args[0], const_cast<char *const *>(args));
    _exit(127);
}

static int run_child(const char *const *args, const string &out, double &ms) {
    auto t0 = chrono::steady_clock::now();
    pid_t pid = fork();
    if (pid < 0) { perror("fork"); exit(3); }
    if (pid == 0) child_exec(args, out);
    int status = 0;
    waitpid(pid, &status, 0);
    auto t1 = chrono::steady_clock::now();
    ms = chrono::duration<double, milli>(t1 - t0).count();
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

// 取输出里的第一个 token：多打几行调试信息不影响判定。
static string first_token(const string &path) {
    ifstream f(path);
    string t;
    if (!(f >> t)) return "";
    return t;
}

static void emit(int score, const char *what, double time_ms) {
    const char *status = score >= 100 ? "accepted" : "wrong_answer";
    if (time_ms > 0) {
        printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":100,\\"status\\":\\"%s\\",\\"message\\":\\"%s；用时 %.1f ms\\"}\\n",
               score, status, what, time_ms);
    } else {
        printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":100,\\"status\\":\\"%s\\",\\"message\\":\\"%s\\"}\\n",
               score, status, what);
    }
    fflush(stdout);
}

int main() {
    // mpirun 不按当前目录解析相对路径，会报 could not access or execute ./x。
    char cwd[4096];
    if (getcwd(cwd, sizeof cwd) == nullptr) { perror("getcwd"); exit(3); }
    const string prog = string(cwd) + "/contestant";
    const string out = "contestant.out";

    // --oversubscribe：OpenMPI 在容器里只认出 8 个槽位（cgroup 给的是 16 核）。
    // --bind-to none：避免把 rank 钉在具体核心上。
    const char *args[] = {"/usr/bin/mpirun", "--oversubscribe", "--bind-to", "none",
                          "-np", "4", prog.c_str(), nullptr};

    double ms = 0;
    const int code = run_child(args, out, ms);
    if (code != 0) {
        emit(0, code == 127
                    ? "mpirun 启动失败，或你的程序没有产出可执行文件"
                    : "你的程序非正常退出（崩溃、被信号终止，或 rank 之间死锁后被杀死）",
             0);
        return 0;
    }

    const string got = first_token(out);
    if (got == "PASS") {
        emit(100, "PASS：所有进程都拿到了正确的归约结果", ms);
    } else if (got == "FAIL") {
        emit(0, "FAIL：你自己的自检认为结果不正确", ms);
    } else if (got.empty()) {
        emit(0, "你的程序没有输出任何内容（rank 0 应输出一行 PASS）", ms);
    } else {
        emit(0, "rank 0 的输出既不是 PASS 也不是 FAIL", ms);
    }
    return 0;
}
`;

export const problem = {
  slug: "ring-allreduce",
  title: "Ring Allreduce · 环形全归约",
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
      // 选手提交完整 MPI 程序（自己写 main、自己 MPI_Init）。
      contestantOwnsMain: true,
      build: {
        target: "all",
        // 必须与 makefile 的产物名、run.argv 里的 ./xxx 三处一致。
        artifact: "ring-allreduce",
        wallMs: 120000,
        memoryMb: 2048,
        threads: 1,
      },
      run: { argv: ["./ring-allreduce"] },
      result: { required: true },
      cases: [
        {
          name: "np=4 n=65536",
          argv: ["./ring-allreduce"],
          // 驱动 fork 出 4 个 rank 交给 mpirun，每个 rank 是独立进程、各自消耗
          // CPU 时间，所以 CPU 时间预算要按 rank 数放大。
          threads: 4,
          // 实测参考实现约 0.4 秒。30 秒留足余量，同时拦住死锁的提交。
          timeLimitMs: 30000,
          maxScore: 100,
        },
      ],
      seed: 1,
      // 与题面声明的 256 MB 一致。RLIMIT_AS 是每进程的：驱动和 mpirun 拉起的
      // 4 个 rank 各自独立拿到这个预算，不是它们共享 256 MB。
      memoryLimitMb: 256,
      stackLimitMb: 8,
    },
  },
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的 MPI ring allreduce 实现（完整程序，自检后输出 PASS）",
    tags: ["分布式", "Allreduce", "MPI", "实现题"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
