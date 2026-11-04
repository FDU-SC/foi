#include <mpi.h>
#include <bits/stdc++.h>
using namespace std;
int main(int argc, char** argv) {
    MPI_Init(&argc, &argv);
    int rank, size;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);
    long long n = 0;
    if (rank == 0) { if (!(cin >> n)) n = 200000000LL; }
    MPI_Bcast(&n, 1, MPI_LONG_LONG, 0, MPI_COMM_WORLD);

    double h = 1.0 / n, local = 0.0;
    for (long long i = rank; i < n; i += size) {
        double x = (i + 0.5) * h;
        local += 4.0 / (1.0 + x * x);
    }

    if (rank == 0) {
        double total = local;
        for (int src = 1; src < size; src++) {
            double part;
            MPI_Recv(&part, 1, MPI_DOUBLE, src, 0, MPI_COMM_WORLD, MPI_STATUS_IGNORE);
            total += part;
        }
        cout << fixed << setprecision(10) << total * h << endl;
    } else {
        MPI_Send(&local, 1, MPI_DOUBLE, 0, 0, MPI_COMM_WORLD);
    }

    MPI_Finalize();
    return 0;
}
