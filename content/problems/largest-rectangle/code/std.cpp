#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
  int n;
  if (std::scanf("%d", &n) != 1) return 0;
  std::vector<long long> h(n + 1, 0);
  for (int i = 0; i < n; ++i) std::scanf("%lld", &h[i]);

  // A trailing zero-height bar flushes the stack at the end.
  std::vector<int> stack;
  long long best = 0;
  for (int i = 0; i <= n; ++i) {
    while (!stack.empty() && h[stack.back()] >= h[i]) {
      const long long height = h[stack.back()];
      stack.pop_back();
      const int left = stack.empty() ? -1 : stack.back();
      best = std::max(best, height * (i - left - 1));
    }
    stack.push_back(i);
  }
  std::printf("%lld\n", best);
  return 0;
}
