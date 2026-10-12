/**
 * LU Solver Driver
 * Reads input binary, calls the solver, and writes output binary.
 */

#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cstring>
#include <omp.h>

void my_solver(int n, double *A, double *b);

double get_wall_time() {
    using namespace std::chrono;
    auto now = steady_clock::now();
    auto duration = now.time_since_epoch();
    return duration_cast<nanoseconds>(duration).count() * 1e-9;
}

int main(int argc, char *argv[]) {
    if (argc < 3) {
        printf("Usage: %s <input.bin> <output.bin>\n", argv[0]);
        return 1;
    }

    char *input_file = argv[1];
    char *output_file = argv[2];
    
    // 1. 读取数据
    FILE *fp_in = fopen(input_file, "rb");
    if (!fp_in) {
        perror("Error opening input file");
        return 1;
    }

    int n;
    if (fread(&n, sizeof(int), 1, fp_in) != 1) {
        fprintf(stderr, "Error reading N\n");
        return 1;
    }

    printf("Problem size: N = %d\n", n);

    // 分配内存
    double *A = (double*)malloc((size_t)n * n * sizeof(double));
    double *b = (double*)malloc((size_t)n * sizeof(double));

    if (!A || !b) {
        fprintf(stderr, "Memory allocation failed!\n");
        return 1;
    }

    size_t read_res = 0; 

    read_res = fread(A, sizeof(double), (size_t)n * n, fp_in);
    if (read_res != (size_t)n * n) {
        fprintf(stderr, "Error reading matrix A, expected %zu elements, got %zu\n", (size_t)n * n, read_res);
        return 1;
    }
    read_res = fread(b, sizeof(double), (size_t)n, fp_in);
    if (read_res != (size_t)n) {
        fprintf(stderr, "Error reading vector b, expected %zu elements, got %zu\n", (size_t)n, read_res);
        return 1;
    }
    fclose(fp_in);

    // 2. 计时并求解
    printf("Starting solver...\n");
    
    auto start_time = std::chrono::steady_clock::now();
    
    // ==========================================
    // 调用核心求解逻辑
    my_solver(n, A, b); 
    // ==========================================
    
    auto end_time = std::chrono::steady_clock::now();
    std::chrono::duration<double> duration = end_time - start_time;
    
    printf("Solver finished in %.6f seconds.\n", duration.count());
    printf("Performance: %.2f GFLOPS (approx)\n", (2.0/3.0 * n * n * n * 1e-9) / duration.count());

    // 3. 写入结果
    FILE *fp_out = fopen(output_file, "wb");
    if (!fp_out) {
        perror("Error opening output file");
        return 1;
    }

    // 只需要写入解向量 x (此时 b 已经被原地替换成了 x)
    fwrite(b, sizeof(double), (size_t)n, fp_out);
    fclose(fp_out);

    // 清理
    free(A);
    free(b);

    return 0;
}