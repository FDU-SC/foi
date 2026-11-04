// gen <subtask> <test> <seed>: prints one test's input.
#include <cstdio>
#include <cstdlib>
#include <random>
#include <tuple>
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

  const int maxN[] = {0, 1000, 100000, 100000};
  const int maxM[] = {0, 10000, 200000, 200000};
  const long long maxW = subtask == 2 ? 1000 : 1000000000;
  const int n = test == 1 && subtask == 1 ? 1 : maxN[subtask];
  const int m = maxM[subtask];
  const int s = static_cast<int>(rnd(1, n));

  std::vector<std::tuple<int, int, long long>> edges;
  auto edge = [&](long long u, long long v, long long w) {
    if (static_cast<int>(edges.size()) < m) edges.emplace_back(u, v, w);
  };

  switch (test) {
    case 1:
      if (n == 1) edge(1, 1, rnd(0, maxW));
      break;
    case 3:
      // A long chain from the start, with costly shortcuts that never pay off.
      for (int i = 1; i < n; ++i) edge(i, i + 1, rnd(0, maxW / n));
      while (static_cast<int>(edges.size()) < m) {
        const long long u = rnd(1, n), v = rnd(1, n);
        edge(u, v, maxW);
      }
      break;
    case 4:
      // Only the lower half is wired, so the upper half is unreachable from it.
      while (static_cast<int>(edges.size()) < m) edge(rnd(1, n / 2), rnd(1, n / 2), rnd(0, maxW));
      break;
    case 5:
      while (static_cast<int>(edges.size()) < m) {
        const long long u = rnd(1, n);
        edge(u, rnd(0, 2) == 0 ? u : rnd(1, n), rnd(0, 1) == 0 ? 0 : rnd(0, maxW));
      }
      break;
    default:
      while (static_cast<int>(edges.size()) < m) edge(rnd(1, n), rnd(1, n), rnd(0, maxW));
      break;
  }

  const int start = test == 3 ? 1 : test == 4 ? static_cast<int>(rnd(1, n / 2 > 0 ? n / 2 : 1)) : s;
  std::printf("%d %zu %d\n", n, edges.size(), start);
  for (const auto& [u, v, w] : edges) std::printf("%d %d %lld\n", u, v, w);
  return 0;
}
