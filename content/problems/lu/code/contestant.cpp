// The contestant file: implement my_solver here, and do NOT write main --
// driver.cpp already owns it. The judge overwrites this file with payload.source.
//
// What ships here is the naive implementation from the statement (single
// threaded, no blocking). It keeps the problem compilable out of the box and is
// the starting point for local testing. It is correct but slow: at N=2049 it
// already exceeds the 0.5 s limit, so submitting it unchanged scores 0 -- which
// is the whole point of scoring against the per-test full-mark time.
#include <cstdio>
#include <cstdlib>
#include <cmath>

int mydgetrf(double *A,int *ipiv,int n)
{
    // LU decomposition with partial pivoting
    // A is stored in row-major format
    // On exit, A contains L (below diagonal with unit diagonal) and U (on and above diagonal)
    
    for (int k = 0; k < n; k++)
    {
        // Find pivot (max element in column k from row k to n-1)
        int pivot_row = k;
        double max_val = fabs(A[k * n + k]);
        
        for (int i = k + 1; i < n; i++)
        {
            double val = fabs(A[i * n + k]);
            if (val > max_val)
            {
                max_val = val;
                pivot_row = i;
            }
        }
        
        // Check for singularity
        if (max_val < 1e-14)
        {
            return 0; // Matrix is singular
        }
        
        // Record pivot
        ipiv[k] = pivot_row;
        
        // Swap rows k and pivot_row if needed
        if (pivot_row != k)
        {
            for (int j = 0; j < n; j++)
            {
                double tmp = A[k * n + j];
                A[k * n + j] = A[pivot_row * n + j];
                A[pivot_row * n + j] = tmp;
            }
        }
        
        // Compute multipliers and update submatrix
        for (int i = k + 1; i < n; i++)
        {
            // Compute multiplier L[i,k]
            A[i * n + k] = A[i * n + k] / A[k * n + k];
            
            // Update row i: A[i,k+1:n] -= L[i,k] * A[k,k+1:n]
            for (int j = k + 1; j < n; j++)
            {
                A[i * n + j] -= A[i * n + k] * A[k * n + j];
            }
        }
    }
    
    return 1;
}

void mydtrsv(char UPLO,double *A,double *B,int n,int *ipiv)
{
    // Solve triangular system
    // A is in row-major format
    // UPLO='L': solve Lx=B (L has unit diagonal)
    // UPLO='U': solve Ux=B (U has non-unit diagonal)
    
    if (UPLO == 'L' || UPLO == 'l')
    {
        // Forward substitution for lower triangular system with unit diagonal
        // Apply pivoting first
        for (int i = 0; i < n; i++)
        {
            if (ipiv[i] != i)
            {
                double tmp = B[i];
                B[i] = B[ipiv[i]];
                B[ipiv[i]] = tmp;
            }
        }
        
        // Solve Lx=B where L has unit diagonal
        for (int i = 0; i < n; i++)
        {
            for (int j = 0; j < i; j++)
            {
                B[i] -= A[i * n + j] * B[j];
            }
            // Note: L[i,i] = 1, so no division needed
        }
    }
    else if (UPLO == 'U' || UPLO == 'u')
    {
        // Backward substitution for upper triangular system
        // Solve Ux=B
        for (int i = n - 1; i >= 0; i--)
        {
            for (int j = i + 1; j < n; j++)
            {
                B[i] -= A[i * n + j] * B[j];
            }
            B[i] /= A[i * n + i];
        }
    }
}

void my_solver(int n, double *A, double *b)
{
    int *ipiv=(int*)malloc(n*sizeof(int));
    for (int i=0;i<n;i++)
        ipiv[i]=i;
    if (mydgetrf(A,ipiv,n)==0) 
    {
        printf("LU factorization failed: coefficient matrix is singular.\n");
        free(ipiv);
        return;
    }
    mydtrsv('L',A,b,n,ipiv);
    mydtrsv('U',A,b,n,ipiv);
    free(ipiv);
}
