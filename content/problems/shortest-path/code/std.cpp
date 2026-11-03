#include <cstdio>
#include <functional>
#include <queue>
#include <utility>
#include <vector>

int main() {
  int n, m, s;
  if (std::scanf("%d %d %d", &n, &m, &s) != 3) return 0;
  std::vector<std::vector<std::pair<int, long long>>> out(n + 1);
  for (int i = 0; i < m; ++i) {
    int u, v;
    long long w;
    std::scanf("%d %d %lld", &u, &v, &w);
    out[u].emplace_back(v, w);
  }

  const long long unreached = -1;
  std::vector<long long> dist(n + 1, unreached);
  using Item = std::pair<long long, int>;
  std::priority_queue<Item, std::vector<Item>, std::greater<Item>> frontier;
  dist[s] = 0;
  frontier.emplace(0, s);
  while (!frontier.empty()) {
    const auto [d, u] = frontier.top();
    frontier.pop();
    if (d != dist[u]) continue;
    for (const auto& [v, w] : out[u]) {
      if (dist[v] == unreached || d + w < dist[v]) {
        dist[v] = d + w;
        frontier.emplace(dist[v], v);
      }
    }
  }
  for (int i = 1; i <= n; ++i) std::printf("%lld\n", dist[i]);
  return 0;
}
