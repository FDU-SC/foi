#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
  int n, W;
  if (std::scanf("%d %d", &n, &W) != 2) return 0;
  std::vector<long long> best(W + 1, 0);
  for (int i = 0; i < n; ++i) {
    int w;
    long long v;
    std::scanf("%d %lld", &w, &v);
    for (int j = W; j >= w; --j) best[j] = std::max(best[j], best[j - w] + v);
  }
  std::printf("%lld\n", best[W]);
  return 0;
}
