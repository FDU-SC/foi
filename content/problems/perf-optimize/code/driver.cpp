#include <bits/stdc++.h>

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
    fprintf(f, "%d\n", n);
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
        fputc('\n', f);
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
    printf("FOI_RESULT {\"score\":%d,\"maxScore\":100,\"status\":\"%s\","
           "\"message\":\"%s；用时 %.2f ms，基线 %.2f ms，加速 %.2fx\"}\n",
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
        cout << '\n';
    }
    return 0;
}

int main(int argc, char *argv[]) {
    if (argc == 2 && string(argv[1]) == "--baseline") return baseline_mode();
    if (argc != 4) {
        fprintf(stderr, "Usage: %s <n> <seed> <base>\n", argv[0]);
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
