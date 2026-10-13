#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <omp.h>

#define BLOCK_SIZE 16

void mydgemm(double *A,double *B,int n,int bid,int b)
{
    // 分块矩阵乘法：更新右下角子矩阵
    // 计算：A[right_bottom] = A[right_bottom] - A[left_block] * A[top_block]
    // 
    // 优化策略：
    // 1. 使用分块（blocking）提高缓存命中率
    // 2. 使用 i-k-j 循环顺序，使内存访问更连续
    // 3. 小块大小选择 32，这个值可以tune一下
    
    int block_start = bid * b;          // 当前块的起始位置
    int block_end = block_start + b;    // 当前块的结束位置
    if (block_end > n) block_end = n;
    
    int right_start = block_end;        // 右下子矩阵的起始位置
    int matrix_size = n - right_start;  // 右下子矩阵的大小
    
    // 如果右下子矩阵很小，直接使用简单实现
    if (matrix_size <= BLOCK_SIZE)
    {
        // 使用 i-k-j 顺序，更缓存友好
        #pragma omp parallel for
        for (int i = right_start; i < n; i++)
        {
            size_t row_offset = (size_t)i * n;  // 优化：预计算行偏移
            for (int k = block_start; k < block_end; k++)
            {
                double a_ik = A[row_offset + k];
                size_t k_row_offset = (size_t)k * n;
                for (int j = right_start; j < n; j++)
                {
                    A[row_offset + j] -= a_ik * A[k_row_offset + j];
                }
            }
        }
        return;
    }
    
    // 对于大矩阵，使用分块算法
    // 分块大小：32×32
    int tile_size = BLOCK_SIZE;
    
    // 外层循环：遍历右下子矩阵的块（可并行）
    #pragma omp parallel for schedule(static)
    for (int ii = right_start; ii < n; ii += tile_size)
    {
        for (int jj = right_start; jj < n; jj += tile_size)
        {
            int i_end = ii + tile_size;
            if (i_end > n) i_end = n;
            
            int j_end = jj + tile_size;
            if (j_end > n) j_end = n;
            
            // 对当前块进行计算
            // 遍历 k 维度的所有数据
            for (int kk = block_start; kk < block_end; kk += tile_size)
            {
                int k_end = kk + tile_size;
                if (k_end > block_end) k_end = block_end;
                
                // 内层循环：在小块内使用 i-k-j 顺序
                for (int i = ii; i < i_end; i++)
                {
                    size_t row_offset = (size_t)i * n;  // 优化：预计算行偏移
                    for (int k = kk; k < k_end; k++)
                    {
                        double a_ik = A[row_offset + k];
                        size_t k_row_offset = (size_t)k * n;
                        // 向量化友好：连续访问内存
                        #pragma omp simd
                        for (int j = jj; j < j_end; j++)
                        {
                            A[row_offset + j] -= a_ik * A[k_row_offset + j];
                        }
                    }
                }
            }
        }
    }
}

int mydgetrf_block(double * __restrict__ A, int * __restrict__ ipiv, int n)
{
    // 块大小：根据CPU缓存大小tune一下
    int b = BLOCK_SIZE;
    
    /*
     * 分块LU分解的核心思想：
     * 
     * 标准算法每次处理1列（k从0到n-1）：
     *   for k = 0 to n-1:
     *     1. 找主元，交换行
     *     2. 计算L[i,k] = A[i,k]/A[k,k]（i > k）
     *     3. 更新子矩阵 A[i,j] -= L[i,k]*A[k,j]（i,j > k）
     * 
     * 分块算法每次处理b列（一个块）：
     *   for block = 0 to (n/b)-1:
     *     1. 对对角块做标准LU分解（处理b列）同时完成对角块下侧的更新。
     *     2. 更新对角块右侧（相当于一次性处理b行的上三角更新）
     *     3. 更新右下角子矩阵（用块矩阵乘法替代逐元素更新）
     */
    
    // 将n×n矩阵分成多个b×b的块
    for (int block_id = 0; block_id * b < n; block_id++)
    {
        int block_start = block_id * b;                                    // 当前块起始行/列
        int block_end = block_start + b;                                   // 当前块结束行/列
        if (block_end > n) block_end = n;                                  // 处理最后一个不完整的块
        
        // ============================================================================
        // 步骤1：对当前对角块执行标准LU分解
        // ============================================================================
        // 这部分与my.c中的mydgetrf完全相同，只是范围限制在[block_start, block_end)
        //
        // 对应标准算法的：
        //   for k = block_start to block_end-1:
        //     找主元、交换、计算L、更新块内子矩阵
        
        for (int k = block_start; k < block_end; k++)
        {
            // 找主元（从第k行到最后一行）
            int pivot_row = k;
            double max_val = fabs(A[k * n + k]);            
            for (int i = k + 1; i < n; i++) {
                double val = fabs(A[i * n + k]);
                if (val > max_val) {
                    max_val = val;
                    pivot_row = i;
                }
            }
            // 奇异性检查
            if (max_val < 1e-14) {
                return 0;
            }
            // 记录置换
            ipiv[k] = pivot_row;
            // 行交换（整行交换，不只是块内）
            if (pivot_row != k) {
                size_t k_offset = (size_t)k * n;
                size_t pivot_offset = (size_t)pivot_row * n;
                for (int j = 0; j < n; j++) {
                    double tmp = A[k_offset + j];
                    A[k_offset + j] = A[pivot_offset + j];
                    A[pivot_offset + j] = tmp;
                }
            }
            
            // 计算L矩阵的乘数（对所有k行以下的行）
            double tmp = 1.0 / A[k * n + k];
            for (int i = k + 1,pos=i*n+k; i < n; i++,pos+=n) {
                A[pos] = A[pos] * tmp;
            }
            
            // 更新子矩阵（只更新块内的列，即 [k+1, block_end)）
            // 对应标准算法中：A[i,j] -= A[i,k] * A[k,j]，但j只到block_end
            size_t k_row_offset = (size_t)k * n;
            for (int i = k + 1; i < n; i++)
            {
                size_t i_row_offset = (size_t)i * n;
                double multiplier = A[i_row_offset + k];
                #pragma omp simd 
                for (int j = k + 1; j < block_end; j++)
                {
                    A[i_row_offset + j] -= multiplier * A[k_row_offset + j];
                }
            }
        }
        
        // 如果还有剩余的矩阵需要更新
        if (block_end < n)
        {
            // ============================================================================
            // 步骤2：解三角方程 L11 * U12 = A12，求出U12
            // ============================================================================
            // L11是刚才得到的对角块（下三角，对角为1）
            // A12是对角块右侧的矩阵（block_start:block_end行，block_end:n列）
            // 需要用前向替换求解每一列
            //
            // 对U12的每一列j（从block_end到n）：
            //   对该列的每一行i（从block_start到block_end）：
            //     U12[i,j] = A12[i,j] - Σ(L11[i,k] * U12[k,j])，k从block_start到i-1
            //     因为L11[i,i]=1，不需要除法
            
            // 可以并行处理每一列
            #pragma omp parallel for schedule(static)
            for (int j = block_end; j < n; j++)  // 对右侧的每一列
            {
                for (int i = block_start; i < block_end; i++)  // 从上到下（前向替换）
                {
                    size_t i_row_offset = (size_t)i * n;
                    // A[i,j] -= Σ L11[i,k] * U12[k,j]，k从block_start到i-1
                    for (int k = block_start; k < i; k++)
                    {
                        size_t k_row_offset = (size_t)k * n;
                        A[i_row_offset + j] -= A[i_row_offset + k] * A[k_row_offset + j];
                    }
                    // L11[i,i]=1，所以不需要除法
                }
            }
            
            // ============================================================================
            // 步骤3：更新右下角子矩阵 A22 = A22 - L21 * U12
            // ============================================================================
            // 这是Schur补更新，也是分块算法的核心优化
            //
            // 此时：
            // - L21已经计算好了（对角块下方的列）
            // - U12已经计算好了（对角块右侧的行）
            
            mydgemm(A, A, n, block_id, block_end - block_start);
        }
    }
    
    return 1;
}

void mydtrsv(char UPLO, double* __restrict__ A, double* __restrict__  B, int n, int* __restrict__ ipiv)
{
    if (UPLO == 'L' || UPLO == 'l')
    {
        // 1. Pivoting
        for (int i = 0; i < n; i++) {
            if (ipiv[i] != i) {
                double tmp = B[i];
                B[i] = B[ipiv[i]];
                B[ipiv[i]] = tmp;
            }
        }
        
        // 2. Forward
        for (int i = 0; i < n; i++) {
            double sum = 0.0;
            size_t i_offset = (size_t)i * n;
            
            // 纯串行，但强制 SIMD
            #pragma omp simd reduction(+:sum)
            for (int j = 0; j < i; j++) {
                sum += A[i_offset + j] * B[j];
            }
            B[i] -= sum;
        }
    }
    else
    {
        // 3. Backward
        for (int i = n - 1; i >= 0; i--) {
            double sum = 0.0;
            size_t i_offset = (size_t)i * n;
            
            #pragma omp simd reduction(+:sum)
            for (int j = i + 1; j < n; j++) {
                sum += A[i_offset + j] * B[j];
            }
            B[i] -= sum;
            B[i] /= A[i_offset + i];
        }
    }
}
void my_solver(int n, double *A, double *b)
{
    int *ipiv=(int*)malloc(n*sizeof(int));
    for (int i=0;i<n;i++)
        ipiv[i]=i;
    if (mydgetrf_block(A,ipiv,n)==0) 
    {
        printf("LU factorization failed: coefficient matrix is singular.\n");
        free(ipiv);
        return;
    }
    mydtrsv('L',A,b,n,ipiv);
    mydtrsv('U',A,b,n,ipiv);
    free(ipiv);
}