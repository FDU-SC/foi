// gen <subtask> <test> <seed>: prints one test's input.
#include <cstdio>
#include <cstdlib>
#include <random>

static std::mt19937_64 rng;

static long long rnd(long long lo, long long hi) {
  return lo + static_cast<long long>(rng() % static_cast<unsigned long long>(hi - lo + 1));
}

int main(int argc, char** argv) {
  if (argc != 4) return 2;
  const int subtask = std::atoi(argv[1]);
  const int test = std::atoi(argv[2]);
  rng.seed(std::strtoull(argv[3], nullptr, 10) * 1000003ULL + subtask * 1009ULL + test);

  const int maxN[] = {0, 20, 100, 1000};
  const int maxW[] = {0, 10000, 1000, 10000};
  int n = maxN[subtask];
  const int W = test == 1 ? static_cast<int>(rnd(1, 50)) : static_cast<int>(rnd(maxW[subtask] / 2, maxW[subtask]));
  const long long big = 1000000000;

  if (test == 1 && subtask == 1) n = 1;
  std::printf("%d %d\n", n, W);

  for (int i = 0; i < n; ++i) {
    long long w, v;
    switch (test) {
      case 3:
        w = rnd(1, W / 10 > 0 ? W / 10 : 1);
        v = rnd(1, big);
        break;
      case 4:
        w = rnd(W / 2 > 0 ? W / 2 : 1, W);
        v = rnd(1, big);
        break;
      case 5:
        w = rnd(1, W);
        v = w * 100000 + rnd(0, 3);
        break;
      default:
        w = rnd(1, W);
        v = rnd(1, big);
        break;
    }
    std::printf("%lld %lld\n", w, v);
  }
  return 0;
}
