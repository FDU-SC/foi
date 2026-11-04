// Harness for the OpenMP pi integration problem.
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

/** Points for a 2x speedup, i.e. `floor(50 * baseline / time)`. */
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
 * Runs `argv` with `n` on stdin and measures only its lifetime.
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
        fprintf(stderr, "usage: %s <n> <base> <perf> <seed>\n", argv[0]);
        return 2;
    }

    const long long n = strtoll(argv[1], nullptr, 10);
    const int base = atoi(argv[2]);
    const int perf = atoi(argv[3]);
    const int maxScore = base + perf;

    char input[64];
    snprintf(input, sizeof input, "%lld\n", n);

    const Run mine = runChild("./contestant", input);
    if (!mine.ok) {
        printf("FOI_RESULT {\"score\":0,\"maxScore\":%d,\"status\":\"runtime_error\","
               "\"message\":\"你的程序没有正常结束或没有输出一个浮点数（退出状态 %d）\"}\n",
               maxScore, mine.status);
        return 0;
    }
    if (!closeEnough(mine.value, PI)) {
        printf("FOI_RESULT {\"score\":0,\"maxScore\":%d,\"status\":\"wrong_answer\","
               "\"message\":\"输出 %.10f，与 pi 的相对误差 %.3g，超过 1e-6\"}\n",
               maxScore, mine.value, fabs(mine.value - PI) / PI);
        return 0;
    }

    const Run baseline = runChild("./baseline", input);
    if (!baseline.ok) {
        // The reference failing is the problem's fault, not the contestant's, so
        // exit non-zero: the judge turns that into a disruption rather than a
        // verdict against the submission.
        fprintf(stderr, "baseline 未能正常运行（退出状态 %d）\n", baseline.status);
        return 1;
    }

    // Scoring, matching what the statement promises:
    //
    //   serial submission        -> base            (about 50)
    //   twice as fast as serial  -> base + perf     (full marks)
    //
    // So each 1.0x of speedup is worth `perf`, capped at the full score.
    const double speedup = baseline.ms / (mine.ms > 0 ? mine.ms : baseline.ms);
    const int score =
        (int)fmin((double)maxScore, floor((double)base + (double)perf * (speedup - 1.0)));

    printf("FOI_RESULT {\"score\":%d,\"maxScore\":%d,\"status\":\"%s\","
           "\"message\":\"n=%lld，你 %.1f ms，串行参考 %.1f ms，加速比 %.2fx\"}\n",
           score, maxScore, score >= maxScore ? "accepted" : "partial", n, mine.ms,
           baseline.ms, speedup);
    return 0;
}
