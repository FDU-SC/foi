/*
 * LU Solver Checker
 * Check if the solution x satisfies ||Ax - b|| / ||b|| < threshold
 */

#include <iostream>
#include <vector>
#include <string>
#include <fstream>
#include <cmath>
#include <iomanip>

// The statement promises that r > 1e-5 scores zero for that test point, so the
// check has to sit at 1e-5. It used to be 1e-6 here, which failed solutions that
// were inside what the problem advertised.
const double THRESHOLD = 1e-5;

int main(int argc, char *argv[]) {
    std::string input_file = "input.bin";
    std::string output_file = "output.bin";
    
    if (argc >= 2) input_file = argv[1];
    if (argc >= 3) output_file = argv[2];

    std::ifstream fin(input_file, std::ios::binary);
    if (!fin) {
        std::cerr << "[Error] Cannot open input file: " << input_file << std::endl;
        return 1;
    }

    int n;
    fin.read(reinterpret_cast<char*>(&n), sizeof(int));
    
    if (n <= 0) {
        std::cerr << "[Error] Invalid matrix size N=" << n << std::endl;
        return 1;
    }

    std::vector<double> A(static_cast<size_t>(n) * n);
    std::vector<double> b(n);
    
    fin.read(reinterpret_cast<char*>(A.data()), A.size() * sizeof(double));
    fin.read(reinterpret_cast<char*>(b.data()), b.size() * sizeof(double));
    fin.close();

    std::ifstream fout(output_file, std::ios::binary);
    if (!fout) {
        std::cerr << "[Error] Cannot open user output file: " << output_file << std::endl;
        return 1;
    }

    std::vector<double> x(n);
    fout.read(reinterpret_cast<char*>(x.data()), x.size() * sizeof(double));
    
    if (!fout.good() && !fout.eof()) {
        std::cerr << "[Error] Failed to read output file properly." << std::endl;
        fout.close();
        return 1;
    }
    
    if (fout.gcount() != static_cast<std::streamsize>(n * sizeof(double))) {
        std::cerr << "[Warning] Output file size mismatch. Expected " << n << " doubles, got " 
                  << fout.gcount() / sizeof(double) << " doubles." << std::endl;
    }
    
    fout.close();

    // Calculate r = Ax - b
    // Use L2 Norm
    double norm_diff_sq = 0.0;
    double norm_b_sq = 0.0;

    for (int i = 0; i < n; ++i) {
        double Ax_i = 0.0;
        for (int j = 0; j < n; ++j) {
            Ax_i += A[static_cast<size_t>(i) * n + j] * x[j];
        }
        
        double diff = Ax_i - b[i];
        norm_diff_sq += diff * diff;
        norm_b_sq += b[i] * b[i];
    }

    double norm_diff = std::sqrt(norm_diff_sq);
    double norm_b = std::sqrt(norm_b_sq);
    
    if (norm_b < 1e-15) norm_b = 1.0;

    double relative_error = norm_diff / norm_b;

    // 4. 输出结果
    std::cout << "---------------------------------------" << std::endl;
    std::cout << "Checker Result:" << std::endl;
    std::cout << "Matrix Size N   : " << n << std::endl;
    std::cout << "||b||           : " << std::scientific << std::setprecision(6) << norm_b << std::endl;
    std::cout << "||Ax - b||      : " << std::scientific << std::setprecision(6) << norm_diff << std::endl;
    std::cout << "Relative Error  : " << std::scientific << std::setprecision(6) << relative_error << std::endl;
    std::cout << "Threshold       : " << std::scientific << std::setprecision(6) << THRESHOLD << std::endl;
    std::cout << "---------------------------------------" << std::endl;

    if (relative_error <= THRESHOLD) {
        std::cout << "[PASSED] Answer is correct." << std::endl;
        return 0; // 返回 0 表示成功，脚本可以用 $? 捕获
    } else {
        std::cout << "[FAILED] Error too large!" << std::endl;
        return 1; // 返回非 0 表示失败
    }
}
