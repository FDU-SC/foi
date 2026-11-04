#include <bits/stdc++.h>

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
    printf("FOI_RESULT {\"score\":%d,\"maxScore\":100,\"status\":\"%s\",\"message\":\"%s；用时 %.1f ms，基线 %.1f ms，加速 %.2fx\"}\n",
           score, status, what, time_ms, base_ms, base_ms / time_ms);
    fflush(stdout);
}

int main(int argc, char *argv[]) {
    if (argc != 6) {
        fprintf(stderr, "Usage: %s <n> <np> <base> <warmup> <timed>\n", argv[0]);
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
    fprintf(f, "%lld\n", n);
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
