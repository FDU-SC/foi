// gen <subtask> <test> <seed>: prints one test's input.
#include <cstdio>
#include <cstdlib>
#include <random>
#include <utility>

static std::mt19937_64 rng;

static long long rnd(long long lo, long long hi) {
  return lo + static_cast<long long>(rng() % static_cast<unsigned long long>(hi - lo + 1));
}

int main(int argc, char** argv) {
  if (argc != 4) return 2;
  const int subtask = std::atoi(argv[1]);
  const int test = std::atoi(argv[2]);
  rng.seed(std::strtoull(argv[3], nullptr, 10) * 1000003ULL + subtask * 1009ULL + test);

  const int limits[] = {0, 1000, 200000, 200000};
  int n = limits[subtask];
  const int q = limits[subtask];
  const bool updates = subtask != 2;
  const long long big = test == 4 ? 10 : 1000000000;

  if (test == 1 && subtask == 1) n = 1;
  std::printf("%d %d\n", n, q);
  for (int i = 0; i < n; ++i) std::printf("%lld%c", rnd(-big, big), i + 1 == n ? '\n' : ' ');

  for (int i = 0; i < q; ++i) {
    if (updates && rnd(0, 1) == 0) {
      std::printf("1 %lld %lld\n", rnd(1, n), rnd(-big, big));
      continue;
    }
    long long l = rnd(1, n), r = rnd(1, n);
    if (l > r) std::swap(l, r);
    if (test == 3) l = 1, r = n;
    std::printf("2 %lld %lld\n", l, r);
  }
  return 0;
}
