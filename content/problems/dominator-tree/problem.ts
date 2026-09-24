import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * 必经之路（支配树）。
 *
 * 判定与计分都在下面的驱动里：驱动现场生成测试点（确定性 PRNG，种子写死），
 * 用内置的参考解（Lengauer-Tarjan）算出期望输出，再逐个跑选手的程序做比对，
 * 最后按子任务给分。判题机不认识支配树，只负责铺文件、跑 make、读回一行
 * FOI_RESULT。
 *
 * 数据策略与旧的 traditional 判题机相反：那边是**构建镜像时**把 .in/.out 烤进
 * 镜像，配置里只留 testdata: "<slug>/<version>"；这里是**判题时现场生成**，
 * 平台侧因此不需要存任何数据文件，题目配置里也只有一个随机种子。本题数据量大
 * （最大 2×10^5 点、5×10^5 边），所以驱动是**一个子任务一个子任务地**生成与判
 * 定，生成完一个子任务就跑完它再释放，峰值内存只与最大的单个子任务相当。
 *
 * 选手提交的是**完整程序**（contestantOwnsMain: true）：自己写 main()、从 stdin
 * 读图、往 stdout 打印 n 行答案。驱动把它当子进程 exec，所以选手的 I/O 与参考解
 * 完全一致，比对才有意义。
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

dominator-tree: driver.o
	$(CXX) $(CXXFLAGS) -o $@ driver.o

# 判题机跑 make all，所以两个产物都要挂在这里。
all: dominator-tree contestant

clean:
	rm -f dominator-tree contestant driver.o
`;

/**
 * 评测驱动。argv[1] 是每个测试点的挂钟上限（毫秒）。
 *
 * 数据生成逻辑逐字对应旧判题机里的
 * `foi-runners-internal/traditional/src/problems/dominator-tree/gen.ts`：
 * 同一套 mulberry32、同一个种子、同样的抽取顺序，所以生成出来的图与旧数据完全
 * 一致。改这里等于改测试数据。
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

struct Edge {
    int u, v;
};

struct Graph {
    int n;
    int s;
    vector<Edge> edges;
};

// between(random, lo, hi)：两端闭区间。JS 里是 floor(random * (hi - lo + 1)) + lo，
// 这里保持同样的浮点运算顺序，否则抽取结果会错位。
static int between(Rng &random, int lo, int hi) {
    return lo + (int)floor(random.next() * (double)(hi - lo + 1));
}

// 与旧 render() 相同的字节：一行 "n m s"，然后 m 行边，末尾换行。
static string render(const Graph &G) {
    string s = to_string(G.n) + " " + to_string(G.edges.size()) + " " + to_string(G.s) + "\\n";
    for (const Edge &e : G.edges) {
        s += to_string(e.u);
        s += ' ';
        s += to_string(e.v);
        s += '\\n';
    }
    return s;
}

// 均匀随机的有向边，自环与重边刻意保留。
static vector<Edge> scattered(Rng &random, int n, int m) {
    vector<Edge> edges(m);
    for (int i = 0; i < m; i++) {
        edges[i].u = between(random, 1, n);
        edges[i].v = between(random, 1, n);
    }
    return edges;
}

// 一条链：支配树退化成深度 n-1 的直链。
static vector<Edge> chain(int n) {
    vector<Edge> edges;
    edges.reserve(n > 0 ? n - 1 : 0);
    for (int i = 1; i < n; i++) edges.push_back({i, i + 1});
    return edges;
}

// 与旧 shuffle() 相同的 Fisher-Yates：从后往前，j 取 [0, i]。
static void shuffleInPlace(Rng &random, vector<int> &items) {
    for (int i = (int)items.size() - 1; i > 0; i--) {
        const int j = between(random, 0, i);
        const int tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
    }
}

// 以 s 为根的分层 DAG，边只在相邻层之间。先把每一层铺满保证全图可达，
// 剩下的预算花在平行边上——这正是让支配树有的地方浅、有的地方深的原因。
static vector<Edge> layered(Rng &random, int n, int m, int s, int width) {
    vector<int> rest;
    rest.reserve(n > 0 ? n - 1 : 0);
    for (int v = 1; v <= n; v++)
        if (v != s) rest.push_back(v);
    shuffleInPlace(random, rest);

    vector<vector<int>> layers;
    layers.push_back(vector<int>{s});
    for (size_t i = 0; i < rest.size(); i += (size_t)width) {
        vector<int> layer;
        for (size_t k = i; k < rest.size() && k < i + (size_t)width; k++) layer.push_back(rest[k]);
        layers.push_back(layer);
    }

    vector<Edge> edges;
    for (size_t i = 0; i + 1 < layers.size(); i++) {
        const vector<int> &from = layers[i];
        for (int v : layers[i + 1])
            edges.push_back({from[between(random, 0, (int)from.size() - 1)], v});
    }

    while ((int)edges.size() < m && layers.size() > 1) {
        const int i = between(random, 0, (int)layers.size() - 2);
        const vector<int> &from = layers[i];
        const vector<int> &to = layers[i + 1];
        edges.push_back({from[between(random, 0, (int)from.size() - 1)],
                         to[between(random, 0, (int)to.size() - 1)]});
    }

    if ((int)edges.size() > m) edges.resize(m);
    return edges;
}

// 一半的点从 1 号点接出来，另一半是一座到不了的孤岛。
static vector<Edge> halfUnreachable(Rng &random, int n, int m) {
    const int live = max(2, n / 2);
    vector<Edge> edges;

    for (int i = 2; i <= live; i++) edges.push_back({between(random, 1, i - 1), i});
    for (int i = live + 2; i <= n; i++) edges.push_back({between(random, live + 1, i - 1), i});

    while ((int)edges.size() < m) {
        const bool inLive = random.next() < 0.5;
        edges.push_back(inLive ? Edge{between(random, 1, live), between(random, 1, live)}
                               : Edge{between(random, live + 1, n), between(random, live + 1, n)});
    }

    if ((int)edges.size() > m) edges.resize(m);
    return edges;
}

// 一条「关口」脊线，每个关口只能从前一个关口到达，关口旁边挂一圈侧点。
// 构造便宜，但对任何不是真支配树算法的做法都很不友好。
static vector<Edge> gateways(Rng &random, int n, int m) {
    vector<Edge> edges;
    const int spine = max(2, (int)floor(sqrt((double)n)));
    const int step = max(2, n / spine);

    for (int gate = 1; gate + step <= n; gate += step) {
        const int nextGate = gate + step;
        for (int side = gate + 1; side < nextGate; side++) {
            edges.push_back({gate, side});
            edges.push_back({side, nextGate});
            // random() 无条件抽一次，与 JS 的短路求值一致。
            const bool flip = random.next() < 0.3;
            if (flip && side + 1 < nextGate) edges.push_back({side, side + 1});
        }
    }

    while ((int)edges.size() < m) {
        const int u = between(random, 1, n);
        edges.push_back({u, between(random, 1, n)});
    }

    if ((int)edges.size() > m) edges.resize(m);
    return edges;
}

// 生成器持有 PRNG 状态：一个子任务一个子任务地生成，抽取顺序与旧 gen.ts 的
// 整份 generate() 完全相同，只是不再把 19 个测试点同时留在内存里。
struct Generator {
    Rng random;
    Generator() : random(0x646f6du) {}

    // 顺序必须与旧 gen.ts 一致，否则随机序列会错位。
    vector<Graph> small() {
        vector<Graph> out;
        out.push_back({6, 1,
                       {{1, 2}, {1, 3}, {2, 4}, {3, 4}, {4, 5}, {5, 6}, {2, 6}, {3, 6}}});
        out.push_back({1, 1, {}});
        out.push_back({2, 1, {{2, 1}}});
        out.push_back({1000, 1, chain(1000)});
        out.push_back({1000, 1, scattered(random, 1000, 10000)});
        out.push_back({1000, 1, layered(random, 1000, 10000, 1, 20)});
        out.push_back({1000, 500, halfUnreachable(random, 1000, 8000)});
        return out;
    }

    vector<Graph> medium() {
        vector<Graph> out;
        out.push_back({100000, 1, chain(100000)});
        out.push_back({100000, 1, scattered(random, 100000, 200000)});
        out.push_back({100000, 1, layered(random, 100000, 200000, 1, 100)});
        out.push_back({100000, 1, gateways(random, 100000, 200000)});
        out.push_back({100000, 42, halfUnreachable(random, 100000, 200000)});
        out.push_back({100000, 1, scattered(random, 100000, 200000)});
        out.push_back({50000, 1, layered(random, 50000, 150000, 1, 4)});
        return out;
    }

    vector<Graph> large() {
        vector<Graph> out;
        out.push_back({200000, 1, chain(200000)});
        out.push_back({200000, 1, scattered(random, 200000, 500000)});
        out.push_back({200000, 1, layered(random, 200000, 500000, 1, 200)});
        out.push_back({200000, 1, gateways(random, 200000, 500000)});
        out.push_back({200000, 7, halfUnreachable(random, 200000, 500000)});
        out.push_back({200000, 1, layered(random, 200000, 500000, 1, 2)});
        return out;
    }
};

// ---- 参考解：与旧 std.cpp 相同，Lengauer-Tarjan + 路径压缩 ----
//
// 全程迭代：n 到 2×10^5、m 到 5×10^5，递归 DFS 或递归并查集都会爆栈。
struct Dominators {
    vector<int> headOut, nextOut, toOut;
    vector<int> headIn, nextIn, fromIn;
    vector<int> dfn, sdom, mn, dsu, parent, idom, depth;
    vector<vector<int>> bucket;
    vector<int> compressPath;
    int n;

    int find(int x) {
        if (dsu[x] == x) return x;

        compressPath.clear();
        while (dsu[x] != x) {
            compressPath.push_back(x);
            x = dsu[x];
        }
        const int root = x;

        // 从最靠近根的点往回走，这样每一步看到的父节点都已经压缩过。
        for (int i = (int)compressPath.size() - 1; i >= 0; --i) {
            const int y = compressPath[i];
            if (dfn[sdom[mn[dsu[y]]]] < dfn[sdom[mn[y]]]) mn[y] = mn[dsu[y]];
            dsu[y] = root;
        }
        return root;
    }

    // 返回 n+1 个元素，下标 1..n：不可达为 -1，其余为支配树深度。
    vector<int> solve(const Graph &G) {
        n = G.n;
        const int m = (int)G.edges.size();
        const int s = G.s;

        headOut.assign(n + 1, -1);
        headIn.assign(n + 1, -1);
        nextOut.assign(m, 0);
        nextIn.assign(m, 0);
        toOut.assign(m, 0);
        fromIn.assign(m, 0);

        for (int e = 0; e < m; ++e) {
            const int u = G.edges[e].u;
            const int v = G.edges[e].v;
            toOut[e] = v;
            nextOut[e] = headOut[u];
            headOut[u] = e;
            fromIn[e] = u;
            nextIn[e] = headIn[v];
            headIn[v] = e;
        }

        dfn.assign(n + 1, 0);
        sdom.assign(n + 1, 0);
        mn.assign(n + 1, 0);
        dsu.assign(n + 1, 0);
        parent.assign(n + 1, 0);
        idom.assign(n + 1, 0);
        depth.assign(n + 1, -1);
        vector<int> order;
        order.reserve(n);

        for (int i = 0; i <= n; ++i) {
            sdom[i] = i;
            mn[i] = i;
            dsu[i] = i;
        }

        // 迭代版 DFS：递归在 n=2×10^5 时会爆栈。
        {
            vector<int> cursor(headOut);
            vector<int> stk;
            stk.reserve(n);
            dfn[s] = 1;
            order.push_back(s);
            stk.push_back(s);

            while (!stk.empty()) {
                const int u = stk.back();
                int e = cursor[u];
                bool descended = false;
                while (e != -1) {
                    const int v = toOut[e];
                    e = nextOut[e];
                    if (dfn[v] == 0) {
                        cursor[u] = e;
                        dfn[v] = (int)order.size() + 1;
                        parent[v] = u;
                        order.push_back(v);
                        stk.push_back(v);
                        descended = true;
                        break;
                    }
                }
                if (!descended) {
                    cursor[u] = -1;
                    stk.pop_back();
                }
            }
        }

        bucket.assign(n + 1, vector<int>());

        for (int i = (int)order.size() - 1; i >= 1; --i) {
            const int u = order[i];

            for (int e = headIn[u]; e != -1; e = nextIn[e]) {
                const int v = fromIn[e];
                if (dfn[v] == 0) continue;
                find(v);
                if (dfn[sdom[mn[v]]] < dfn[sdom[u]]) sdom[u] = sdom[mn[v]];
            }

            bucket[sdom[u]].push_back(u);
            dsu[u] = parent[u];

            vector<int> &pending = bucket[parent[u]];
            for (size_t j = 0; j < pending.size(); ++j) {
                const int v = pending[j];
                find(v);
                idom[v] = (sdom[mn[v]] == parent[u]) ? parent[u] : mn[v];
            }
            pending.clear();
        }

        for (size_t i = 1; i < order.size(); ++i) {
            const int u = order[i];
            if (idom[u] != sdom[u]) idom[u] = idom[idom[u]];
        }

        depth[s] = 0;
        for (size_t i = 1; i < order.size(); ++i) {
            const int u = order[i];
            depth[u] = depth[idom[u]] + 1;
        }

        vector<int> ans(n + 1, -1);
        for (int i = 1; i <= n; ++i) ans[i] = (dfn[i] == 0) ? -1 : depth[i];
        return ans;
    }
};

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

// n 行、每行一个整数：按空白切开再拼回去，多余的换行与空格不影响比对。
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

// 第 k 个空白分隔的 token；越界时返回"(无)"，免得 substr 抛异常。
static string tokenAt(const string &s, size_t k) {
    if (k >= s.size()) return "(无)";
    const size_t e = s.find(' ', k);
    return s.substr(k, (e == string::npos ? s.size() : e) - k);
}

// 一个测试点：先算参考解，再写输入、跑选手、比对。返回是否通过并填 why。
static bool judge_case(const string &prog, const Graph &G, int limitMs, int index,
                       string &firstFail, int &timedOutCount) {
    // 参考解算完就把 Lengauer-Tarjan 的几张大表放掉：fork 出去的选手会继承
    // 这份地址空间，驱动这边少占一点，选手那边的余量就多一点。
    vector<int> ans;
    {
        Dominators dom;
        ans = dom.solve(G);
    }

    string want;
    for (int i = 1; i <= G.n; i++) {
        if (i > 1) want += ' ';
        want += to_string(ans[i]);
    }
    vector<int>().swap(ans);

    const string in = "case.in", out = "case.out";
    {
        FILE *f = fopen(in.c_str(), "wb");
        if (!f) { perror("fopen case.in"); return false; }
        const string data = render(G);
        fwrite(data.data(), 1, data.size(), f);
        fclose(f);
    }

    const CaseRun r = run_one(prog, in, out, limitMs);

    string why;
    if (r.timedOut) {
        timedOutCount += 1;
        why = "超时（限额 " + to_string(limitMs) + " ms）";
    } else if (!r.ok) {
        why = "非正常退出";
    } else {
        const string got = slurp(out);
        if (got != want) {
            // 输出很长，只报第一处不同的行号与前后两个值，别把两万行都塞进消息里。
            size_t k = 0;
            while (k < got.size() && k < want.size() && got[k] == want[k]) k++;
            why = "第 " + to_string(k + 1) + " 行不对（期望 " + tokenAt(want, k) +
                  "，得到 " + tokenAt(got, k) + "）";
        }
    }

    if (why.empty()) return true;
    if (firstFail.empty())
        firstFail = "第 " + to_string(index) + " 个测试点（n=" + to_string(G.n) +
                    " m=" + to_string(G.edges.size()) + "）" + why;
    return false;
}

// 一个子任务：生成、判分、然后整份丢掉，别把三个子任务的数据同时压在内存里。
static void run_subtask(const string &prog, vector<Graph> &graphs, int points, int caseLimitMs,
                        int &total, int &passed, int &all, int &index,
                        string &firstFail, int &timedOutCount) {
    bool ok = true;
    for (const Graph &G : graphs) {
        index += 1;
        all += 1;
        if (judge_case(prog, G, caseLimitMs, index, firstFail, timedOutCount))
            passed += 1;
        else
            ok = false;
    }
    if (ok) total += points;
    vector<Graph>().swap(graphs);
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <case_limit_ms>\\n", argv[0]);
        return 2;
    }
    const int caseLimitMs = atoi(argv[1]);

    // exec 要用绝对路径：子进程的 cwd 是 scratch 目录，但显式给全更稳。
    char cwd[4096];
    if (getcwd(cwd, sizeof cwd) == nullptr) { perror("getcwd"); return 3; }
    const string prog = string(cwd) + "/contestant";

    Generator gen;
    int total = 0, passed = 0, all = 0, index = 0, timedOutCount = 0;
    string firstFail;

    {
        vector<Graph> s = gen.small();
        run_subtask(prog, s, 30, caseLimitMs, total, passed, all, index, firstFail, timedOutCount);
    }
    {
        vector<Graph> s = gen.medium();
        run_subtask(prog, s, 30, caseLimitMs, total, passed, all, index, firstFail, timedOutCount);
    }
    {
        vector<Graph> s = gen.large();
        run_subtask(prog, s, 40, caseLimitMs, total, passed, all, index, firstFail, timedOutCount);
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
  slug: "dominator-tree",
  title: "必经之路",
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
        artifact: "dominator-tree",
        wallMs: 60000,
        memoryMb: 2048,
        threads: 1,
      },
      // argv[1] 是**每个测试点**的挂钟上限，单位毫秒。它必须与题面声明的
      // <Constraints time="3 s"> 一致：旧 traditional 判题机也是逐点套 3000 ms。
      run: { argv: ["./dominator-tree", "3000"] },
      result: { required: true },
      cases: [
        {
          name: "全部子任务",
          argv: ["./dominator-tree", "3000"],
          // 驱动自己挨个 fork 出选手程序，单进程、单线程。
          threads: 1,
          // 驱动要跑 19 个测试点，每个 fork 一次，还要自己算一遍参考解。
          // 逐点限制由驱动内的 caseLimitMs 负责（3000 ms × 19 = 57 s 是最坏
          // 情况的理论上限），这里的 timeLimitMs 只是整轮的兜底，必须不小于
          // 它——否则驱动还在逐点判超时就被判题机杀了，选手看到的是"评测中断"
          // 而不是超时。
          timeLimitMs: 70000,
          maxScore: 100,
        },
      ],
      seed: 1,
      // 与题面声明的 512 MB 一致。注意这是 RLIMIT_AS（每进程），驱动与 fork
      // 出来的选手是各自独立的进程，各自拿到这个预算——不是两者相加。
      memoryLimitMb: 512,
      // 旧判题机把 ulimit -s 顶到与内存同宽，所以递归 DFS 曾是能过的。这里给
      // 64 MB：n=2×10^5 的递归 DFS 够用，又不至于让跑飞的递归吃满整个地址空间。
      stackLimitMb: 64,
    },
  },
  ui: {
    // 题目只收 C++：makefile 是按 C++ 写的。
    languages: ["cpp"],
    tags: ["图论"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
