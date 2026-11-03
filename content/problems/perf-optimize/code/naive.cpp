#include <bits/stdc++.h>

using namespace std;

void naive(vector<vector<long long>> &a, vector<vector<long long>> &b, vector<vector<long long>> &c) {
    int n = a.size();
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            for (int k = 0; k < n; k++) c[i][j] += a[i][k] * b[k][j];
}
