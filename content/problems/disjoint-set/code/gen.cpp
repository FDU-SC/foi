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

  const int limits[] = {0, 1000, 100000, 200000};
  const int n = limits[subtask];
  const int q = limits[subtask];

  // Every person joins one of `groups` groups; relations stay inside a group,
  // so a query between groups is always "No" and within one depends on the edges.
  int groups;
  int m;
  switch (test) {
    case 1: groups = n; m = 0; break;
    case 2: groups = n / 10 > 0 ? n / 10 : 1; m = limits[subtask]; break;
    case 3: groups = 2; m = limits[subtask]; break;
    case 4: groups = 1; m = n / 2; break;
    case 5: groups = n / 3 > 0 ? n / 3 : 1; m = limits[subtask]; break;
    default: groups = n / 100 > 0 ? n / 100 : 1; m = limits[subtask]; break;
  }

  std::vector<std::vector<int>> members(groups);
  std::vector<int> group(n + 1);
  for (int person = 1; person <= n; ++person) {
    group[person] = static_cast<int>(rnd(0, groups - 1));
    members[group[person]].push_back(person);
  }
  auto partner = [&](int person) {
    const auto& list = members[group[person]];
    return list[rnd(0, static_cast<long long>(list.size()) - 1)];
  };

  std::printf("%d %d %d\n", n, m, q);
  for (int i = 0; i < m; ++i) {
    const int x = static_cast<int>(rnd(1, n));
    std::printf("%d %d\n", x, partner(x));
  }
  for (int i = 0; i < q; ++i) {
    const int x = static_cast<int>(rnd(1, n));
    const long long kind = rnd(0, 9);
    const int y = kind < 5 ? partner(x) : kind < 9 ? static_cast<int>(rnd(1, n)) : x;
    std::printf("%d %d\n", x, y);
  }
  return 0;
}
