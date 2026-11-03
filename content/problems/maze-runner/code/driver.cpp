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

static const char EMPTY = '.';
static const char WALL = '#';

struct Grid {
    int n, m;
    vector<string> g;
};

static Grid blank(int n, int m, char fill) {
    return Grid{n, m, vector<string>(n, string(m, fill))};
}

static void openEnds(Grid &G) {
    G.g[0][0] = EMPTY;
    G.g[G.n - 1][G.m - 1] = EMPTY;
}

// between(random, lo, hi)：两端闭区间。JS 里是 floor(random * (hi - lo + 1)) + lo，
// 这里保持同样的浮点运算顺序，否则抽取结果会错位。
static int between(Rng &random, int lo, int hi) {
    return lo + (int)floor(random.next() * (double)(hi - lo + 1));
}

// 独立撒墙，连通性交给运气。
static Grid scattered(Rng &random, int n, int m, double density) {
    Grid G = blank(n, m, EMPTY);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < m; j++)
            if (random.next() < density) G.g[i][j] = WALL;
    openEnds(G);
    return G;
}

// 在奇数坐标上凿迷宫：任意两格之间恰好一条通路，逼出真正的 BFS 而不是贪心走法。
static Grid carved(Rng &random, int n, int m) {
    Grid G = blank(n, m, WALL);
    vector<pair<int, int>> stk;
    stk.push_back(make_pair(0, 0));
    G.g[0][0] = EMPTY;

    const int steps[4][2] = {{-2, 0}, {2, 0}, {0, -2}, {0, 2}};

    while (!stk.empty()) {
        const int r = stk.back().first, c = stk.back().second;
        vector<pair<int, int>> options;
        for (int k = 0; k < 4; k++) {
            const int nr = r + steps[k][0], nc = c + steps[k][1];
            if (nr >= 0 && nr < n && nc >= 0 && nc < m && G.g[nr][nc] == WALL)
                options.push_back(make_pair(nr, nc));
        }

        if (options.empty()) {
            stk.pop_back();
            continue;
        }

        const pair<int, int> pick = options[between(random, 0, (int)options.size() - 1)];
        G.g[(r + pick.first) / 2][(c + pick.second) / 2] = EMPTY;
        G.g[pick.first][pick.second] = EMPTY;
        stk.push_back(pick);
    }

    openEnds(G);
    // 凿出来的迷宫只到奇数坐标；n 或 m 为偶数时终点可能被墙封死，那是想要的 -1 情形。
    return G;
}

// 横贯整个网格的一堵墙：答案是 -1。
static Grid sealedGrid(int n, int m) {
    Grid G = blank(n, m, EMPTY);
    const int row = n / 2;
    for (int j = 0; j < m; j++) G.g[row][j] = WALL;
    openEnds(G);
    return G;
}

// 蛇形单通道穿过每一格：最长可能的答案。
static Grid serpentine(int n, int m) {
    Grid G = blank(n, m, WALL);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < m; j++)
            if (i % 2 == 0) G.g[i][j] = EMPTY;
    for (int i = 1; i < n; i += 2)
        G.g[i][((i - 1) % 4 == 0) ? m - 1 : 0] = EMPTY;
    openEnds(G);
    return G;
}

// 与旧 render() 相同的字节：n m、换行、n 行、末尾换行。
static string render(const Grid &G) {
    string s = to_string(G.n) + " " + to_string(G.m) + "\n";
    for (int i = 0; i < G.n; i++) s += G.g[i] + "\n";
    return s;
}

// 顺序必须与旧 gen.ts 一致，否则随机序列会错位。
static vector<vector<Grid>> generate() {
    Rng random(0x6d417a3u);
    vector<vector<Grid>> out(3);

    Grid sample1 = blank(4, 4, EMPTY);
    sample1.g[1] = ".##.";
    sample1.g[2] = "...#";
    sample1.g[3] = "##..";

    Grid sample2 = blank(2, 2, EMPTY);
    sample2.g[0] = ".#";
    sample2.g[1] = "#.";

    out[0].push_back(sample1);
    out[0].push_back(sample2);
    out[0].push_back(blank(1, 1, EMPTY));
    out[0].push_back(blank(1, 10, EMPTY));
    out[0].push_back(blank(10, 1, EMPTY));
    out[0].push_back(carved(random, 9, 9));
    out[0].push_back(scattered(random, 10, 10, 0.35));

    out[1].push_back(blank(100, 100, EMPTY));
    out[1].push_back(carved(random, 99, 99));
    out[1].push_back(scattered(random, 100, 100, 0.3));
    out[1].push_back(scattered(random, 100, 100, 0.45));
    out[1].push_back(sealedGrid(100, 100));
    out[1].push_back(serpentine(99, 100));
    out[1].push_back(scattered(random, 60, 100, 0.2));

    out[2].push_back(blank(1000, 1000, EMPTY));
    out[2].push_back(carved(random, 999, 999));
    out[2].push_back(scattered(random, 1000, 1000, 0.3));
    out[2].push_back(sealedGrid(1000, 1000));
    out[2].push_back(serpentine(999, 1000));
    out[2].push_back(scattered(random, 1000, 1000, 0.05));

    return out;
}

// ---- 参考解：与旧 std.cpp 相同，从起点做一次 BFS ----

static int shortest(const Grid &G) {
    const int n = G.n, m = G.m;
    vector<int> dist((size_t)n * m, -1);
    vector<int> order((size_t)n * m);
    size_t head = 0, tail = 0;

    if (G.g[0][0] != WALL) {
        dist[0] = 0;
        order[tail++] = 0;
    }

    const int dr[4] = {-1, 1, 0, 0};
    const int dc[4] = {0, 0, -1, 1};

    while (head < tail) {
        const int cur = order[head++];
        const int r = cur / m, c = cur % m;
        for (int k = 0; k < 4; k++) {
            const int nr = r + dr[k], nc = c + dc[k];
            if (nr < 0 || nr >= n || nc < 0 || nc >= m) continue;
            const size_t idx = (size_t)nr * m + nc;
            if (G.g[nr][nc] == WALL || dist[idx] != -1) continue;
            dist[idx] = dist[cur] + 1;
            order[tail++] = (int)idx;
        }
    }

    return dist[(size_t)n * m - 1];
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
    const auto t0 = chrono::steady_clock::now();
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

// 输出只有一个整数，按空白切开再拼回去：多余的换行与空格不影响比对。
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
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <case_limit_ms>\n", argv[0]);
        return 2;
    }
    const int caseLimitMs = atoi(argv[1]);

    // exec 要用绝对路径：子进程的 cwd 是 scratch 目录，但显式给全更稳。
    char cwd[4096];
    if (getcwd(cwd, sizeof cwd) == nullptr) { perror("getcwd"); return 3; }
    const string prog = string(cwd) + "/contestant";

    const vector<vector<Grid>> subtasks = generate();
    const int points[3] = {30, 30, 40};

    int total = 0;
    int passed = 0, all = 0, timedOutCount = 0;
    for (const auto &s : subtasks) all += (int)s.size();

    string firstFail;
    int index = 0;
    for (int si = 0; si < (int)subtasks.size(); si++) {
        bool ok = true;
        for (const Grid &G : subtasks[si]) {
            index += 1;
            const string in = "case.in", out = "case.out";
            {
                FILE *f = fopen(in.c_str(), "w");
                if (!f) { perror("fopen case.in"); return 3; }
                const string data = render(G);
                fwrite(data.data(), 1, data.size(), f);
                fclose(f);
            }

            const CaseRun r = run_one(prog, in, out, caseLimitMs);

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
                const string want = to_string(shortest(G));
                if (got != want) {
                    ok = false;
                    why = "期望 " + want + "，得到 " + (got.empty() ? "(空)" : got);
                }
            }

            if (why.empty()) {
                passed += 1;
            } else if (firstFail.empty()) {
                firstFail = "第 " + to_string(index) + " 个测试点（" +
                            to_string(G.n) + "x" + to_string(G.m) + "）" + why;
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
