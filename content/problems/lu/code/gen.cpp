#include <iostream>
#include <vector>
#include <random>
#include <fstream>
#include <string>
#include <cmath>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: " << argv[0] << " <N> [seed]" << std::endl;
        return 1;
    }
    
    int n = std::stoi(argv[1]);
    std::string filename = "input_" + std::to_string(n) + ".bin";
    
    std::vector<double> A(static_cast<size_t>(n) * n);
    std::vector<double> b(n);
    
    // The judge passes this submission's hidden seed (16 hex characters) as the
    // second argument and mixes it in character by character. With a fixed seed
    // every submission gets the same matrix, and that matrix can be solved
    // offline once and handed in as a table -- N=2049 is 16 KB of doubles.
    std::mt19937 gen(42);
    if (argc >= 3) {
        std::string seedText = argv[2];
        std::seed_seq seq(seedText.begin(), seedText.end());
        gen.seed(seq);
    }
    std::uniform_real_distribution<double> rnd(-10.0, 10.0);
    
    for (size_t i = 0; i < A.size(); ++i) {
        A[i] = rnd(gen);
    }

    // 稍微增强对角线，不做严格对角占优
    for (int i = 0; i < n; ++i) {
        A[i * n + i] += 5.0; 
    }

    for (int i = 0; i < n; ++i) {
        b[i] = rnd(gen);
    }

    std::ofstream fout(filename, std::ios::binary);
    if (!fout) {
        std::cerr << "File open error" << std::endl;
        return 1;
    }
    
    fout.write(reinterpret_cast<const char*>(&n), sizeof(int));
    fout.write(reinterpret_cast<const char*>(A.data()), A.size() * sizeof(double));
    fout.write(reinterpret_cast<const char*>(b.data()), b.size() * sizeof(double));
    
    std::cout << "Generated N=" << n << " data to " << filename << std::endl;
    return 0;
}
