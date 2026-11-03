#include <cstdio>
#include <numeric>
#include <vector>

static std::vector<int> parent;

static int find(int x) {
  while (parent[x] != x) x = parent[x] = parent[parent[x]];
  return x;
}

int main() {
  int n, m, q;
  if (std::scanf("%d %d %d", &n, &m, &q) != 3) return 0;
  parent.resize(n + 1);
  std::iota(parent.begin(), parent.end(), 0);
  for (int i = 0; i < m; ++i) {
    int x, y;
    std::scanf("%d %d", &x, &y);
    parent[find(x)] = find(y);
  }
  for (int i = 0; i < q; ++i) {
    int x, y;
    std::scanf("%d %d", &x, &y);
    std::puts(find(x) == find(y) ? "Yes" : "No");
  }
  return 0;
}
