#include <cstdio>
#include <vector>

static std::vector<long long> a, buffer;

static long long count(int lo, int hi) {
  if (hi - lo <= 1) return 0;
  const int mid = (lo + hi) / 2;
  long long result = count(lo, mid) + count(mid, hi);
  int i = lo, j = mid, k = lo;
  while (i < mid && j < hi) {
    if (a[i] <= a[j]) buffer[k++] = a[i++];
    else result += mid - i, buffer[k++] = a[j++];
  }
  while (i < mid) buffer[k++] = a[i++];
  while (j < hi) buffer[k++] = a[j++];
  for (int t = lo; t < hi; ++t) a[t] = buffer[t];
  return result;
}

int main() {
  int n;
  if (std::scanf("%d", &n) != 1) return 0;
  a.resize(n);
  buffer.resize(n);
  for (auto& x : a) std::scanf("%lld", &x);
  std::printf("%lld\n", count(0, n));
  return 0;
}
