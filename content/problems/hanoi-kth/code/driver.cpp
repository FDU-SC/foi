#include <bits/stdc++.h>

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
// 每个测试点单独起一个进程运行选手程序。选手提交的是完整程序
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
    printf("FOI_RESULT {\"score\":%d,\"maxScore\":100,\"status\":\"%s\",\"message\":\"%s\"}\n",
           score, status, what);
    fflush(stdout);
}

int main(int argc, char **argv) {
    // argv[1] = 每个测试点的挂钟上限（毫秒）。判题机的 timeLimitMs 是整轮的兜底。
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <case_limit_ms>\n", argv[0]);
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
                fprintf(f, "%lld %llu\n", c.n, c.k);
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
