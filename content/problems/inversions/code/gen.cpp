// gen <subtask> <test> <seed>: prints one test's input.
#include <cstdio>
#include <cstdlib>
#include <random>
#include <utility>
#include <vector>

static std::mt19937_64 rng;

static long long rnd(long long lo, long long hi) {
  return lo + static_cast<long long>(rng() % static_cast<unsigned long long>(hi - lo + 1));
}

int main(int argc, char** argv) {
  if (argc != 4) return 2;
  const int subtask = std::atoi(argv[1]);
  const int test = std::atoi(argv[2]);
  rng.seed(std::strtoull(argv[3], nullptr, 10) * 1000003ULL + subtask * 1009ULL + test);

  const int limits[] = {0, 1000, 100000, 500000};
  int n = limits[subtask];
  const long long big = 1000000000;
  std::vector<long long> a;

  switch (test) {
    case 1:
      if (subtask == 1) n = 1;
      a.assign(n, rnd(-big, big));
      break;
    case 2:
      for (int i = 0; i < n; ++i) a.push_back(rnd(-big, big));
      break;
    case 3:
      for (int i = 0; i < n; ++i) a.push_back(rnd(0, 5));
      break;
    case 4:
      for (int i = 0; i < n; ++i) a.push_back(-big + 3LL * i);
      break;
    case 5:
      for (int i = 0; i < n; ++i) a.push_back(big - 3LL * i);
      break;
    default:
      for (int i = 0; i < n; ++i) a.push_back(i);
      for (int k = 0; k < n / 20 + 1; ++k) std::swap(a[rnd(0, n - 1)], a[rnd(0, n - 1)]);
      break;
  }

  std::printf("%d\n", n);
  for (int i = 0; i < n; ++i) std::printf("%lld%c", a[i], i + 1 == n ? '\n' : ' ');
  return 0;
}
