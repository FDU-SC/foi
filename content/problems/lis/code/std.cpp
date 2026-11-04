#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
  int n;
  if (std::scanf("%d", &n) != 1) return 0;
  std::vector<long long> tails;
  for (int i = 0; i < n; ++i) {
    long long x;
    std::scanf("%lld", &x);
    auto it = std::lower_bound(tails.begin(), tails.end(), x);
    if (it == tails.end()) tails.push_back(x);
    else *it = x;
  }
  std::printf("%zu\n", tails.size());
  return 0;
}
