#include <cstdio>
#include <vector>

static int n;
static std::vector<long long> tree;

static void add(int i, long long v) {
  for (; i <= n; i += i & -i) tree[i] += v;
}

static long long prefix(int i) {
  long long sum = 0;
  for (; i > 0; i -= i & -i) sum += tree[i];
  return sum;
}

int main() {
  int q;
  if (std::scanf("%d %d", &n, &q) != 2) return 0;
  tree.assign(n + 1, 0);
  for (int i = 1; i <= n; ++i) {
    long long a;
    std::scanf("%lld", &a);
    add(i, a);
  }
  for (int i = 0; i < q; ++i) {
    int type;
    long long x, y;
    if (std::scanf("%d %lld %lld", &type, &x, &y) != 3) break;
    if (type == 1) add(static_cast<int>(x), y);
    else std::printf("%lld\n", prefix(static_cast<int>(y)) - prefix(static_cast<int>(x) - 1));
  }
  return 0;
}
