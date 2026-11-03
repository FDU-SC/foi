#include <bits/stdc++.h>

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
        printf("FOI_RESULT {\"score\":%d,\"maxScore\":100,\"status\":\"%s\",\"message\":\"%s；用时 %.1f ms\"}\n",
               score, status, what, time_ms);
    } else {
        printf("FOI_RESULT {\"score\":%d,\"maxScore\":100,\"status\":\"%s\",\"message\":\"%s\"}\n",
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
