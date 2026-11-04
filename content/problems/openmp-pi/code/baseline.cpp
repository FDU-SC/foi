// The serial reference the contestant is scored against, and the one the
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
    printf("%.10f\n", sum * h);
    return 0;
}
