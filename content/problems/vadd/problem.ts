import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * vadd · 向量加法。
 *
 * CUDA 入门题，同时也是评测链路的验证题：给两个等长数组，逐元素相加。判定在
 * 驱动里——判题机不认识 CUDA，只负责铺文件、跑 make、跑驱动、读回一行
 * FOI_RESULT。它与 CPU 题真正的差别只有两处：镜像里有没有 nvcc，以及下面这个
 * `addressSpace: "unbounded"`。
 *
 * 选手只交一个 kernel（实现 launch_vector_add），不写 main：驱动持有 main、
 * 设备内存与校验，逐测试点精确比对。
 *
 * 三个与卡绑定的前提，缺一样都跑不起来：
 *  - 评测机那台机必须有卡（容器带 --gpus all），并在平台上声明服务
 *    `interactive` 队列——GPU 题与 CPU 题共用同一支队列，因为判题镜像里既有 nvcc 也有 g++（见 content/backends.ts）；
 *  - makefile 用 `nvcc -arch=native` 让 nvcc 自己问卡，同一道题在 5060 与 A800
 *    上都能编。判题机不向沙箱注入任何 GPU 变量，题目想知道卡就自己问设备；
 *  - `addressSpace: "unbounded"`：CUDA runtime 初始化时会映射整个统一地址空间，
 *    任何 RLIMIT_AS 都会让它失败，而那种报错看起来和选手内存超限一模一样。
 */

/**
 * 编译方式。`-arch=native` 是关键：它让 nvcc 按当前这张卡生成 cubin，而不是把
 * 题目焊死在一代硬件上——换一张卡不需要改这道题。
 *
 * 不写 `-std=`：nvcc 的默认标准与它自带的头文件最匹配，这道题也用不到更新的
 * 标准。`-O2` 对一道只判正确性的题足够。
 */
const MAKEFILE = `vadd: driver.cu kernel.cu
\tnvcc -O2 -arch=native -o $@ $^
`;

/**
 * 评测驱动。命令行：`./vadd <n> <points>`。
 *
 * 数据与校验都在这里：a[i] = i % 1000、b[i] = (i % 7) × 0.5，两者都是能被
 * float 精确表示的小数，和同样精确——所以逐元素 `!=` 比对就够了，不需要容差。
 * 设备内存先全部写成 NaN 字节，kernel 没写到的位置一定不等于正确值，这样"漏算
 * 最后一段"不会因为碰巧留下旧数据而蒙混过去。
 *
 * 分数由 argv 的 points 给出，与 problem.config 里该测试点的 maxScore 一致：
 * 判题机会核对驱动报的 maxScore 与配置是否相同，不一致会把这句话写进 detail。
 */
const DRIVER = `#include <cstdio>
#include <cstdlib>
#include <vector>
#include <cuda_runtime.h>

void launch_vector_add(const float* a, const float* b, float* c, int n);

#define CHECK(call)                                                  \\
  do {                                                               \\
    cudaError_t err = (call);                                        \\
    if (err != cudaSuccess) {                                        \\
      fprintf(stderr, "CUDA error: %s\\n", cudaGetErrorString(err)); \\
      return 1;                                                      \\
    }                                                                \\
  } while (0)

// 一行就是全部协议：score 与 maxScore 必填，message 可选，多一个字段判题机
// 会拒绝整份结果。message 里不能出现引号或换行。
static void emit(int score, int maxScore, const char* message) {
  if (message == nullptr) {
    printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":%d}\\n", score, maxScore);
  } else {
    printf("FOI_RESULT {\\"score\\":%d,\\"maxScore\\":%d,\\"message\\":\\"%s\\"}\\n",
           score, maxScore, message);
  }
  fflush(stdout);
}

int main(int argc, char** argv) {
  if (argc != 3) { fprintf(stderr, "usage: vadd <n> <points>\\n"); return 2; }
  const int n = atoi(argv[1]);
  const int points = atoi(argv[2]);

  const size_t bytes = size_t(n) * sizeof(float);
  std::vector<float> a(n), b(n), c(n);
  for (int i = 0; i < n; i++) {
    a[i] = float(i % 1000);
    b[i] = float(i % 7) * 0.5f;
  }

  float *da, *db, *dc;
  CHECK(cudaMalloc(&da, bytes));
  CHECK(cudaMalloc(&db, bytes));
  CHECK(cudaMalloc(&dc, bytes));
  CHECK(cudaMemcpy(da, a.data(), bytes, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(db, b.data(), bytes, cudaMemcpyHostToDevice));
  CHECK(cudaMemset(dc, 0xff, bytes));

  launch_vector_add(da, db, dc, n);
  // 启动配置非法（每块线程数超限等）在这里现形，而不是变成一份"全对"的结果。
  CHECK(cudaGetLastError());
  CHECK(cudaDeviceSynchronize());
  CHECK(cudaMemcpy(c.data(), dc, bytes, cudaMemcpyDeviceToHost));

  for (int i = 0; i < n; i++) {
    const float want = a[i] + b[i];
    if (c[i] != want) {
      char message[128];
      snprintf(message, sizeof message, "c[%d] = %g，期望 %g", i, c[i], want);
      emit(0, points, message);
      return 0;
    }
  }

  emit(points, points, nullptr);
  return 0;
}
`;

export const problem = {
  slug: "vadd",
  title: "vadd · 向量加法",
  maxScore: 100,
  backend: {
    id: "interactive",
    config: {
      files: [
        { path: "makefile", content: MAKEFILE },
        { path: "driver.cu", content: DRIVER },
        { path: "kernel.cu", content: "(由提交内容覆盖)" },
      ],
      makefile: "makefile",
      contestant: "kernel.cu",
      // 唯一一处 CUDA 逼出来的配置：见文件顶部的说明。
      addressSpace: "unbounded",
      // 没有 memoryLimitMb / build.memoryMb：addressSpace 为 unbounded 时这两个
      // 字段不参与任何限制，写在这里只会让下一个人以为内存被卡在某个值上。
      // 栈上限仍是默认的 8 MB——它和地址空间是两回事，不随这个开关改变。
      build: {
        target: "vadd",
        // 必须与 makefile 的产物名、run.argv 里的 ./vadd 三处一致。
        artifact: "vadd",
        // 容器里第一次调用 nvcc 要加载整套工具链，实测几秒到十几秒。
        wallMs: 120000,
        threads: 1,
      },
      run: { argv: ["./vadd", "1000", "20"] },
      result: { required: true },
      cases: [
        {
          // 每个测试点的 argv 都自带分值，驱动据此报 maxScore。
          name: "n = 1000",
          argv: ["./vadd", "1000", "20"],
          threads: 1,
          // 驱动是单线程的，但每个测试点都要重新初始化一次 CUDA 上下文。
          timeLimitMs: 15000,
          maxScore: 20,
        },
        {
          name: "n = 4194304",
          argv: ["./vadd", "4194304", "30"],
          threads: 1,
          timeLimitMs: 15000,
          maxScore: 30,
        },
        {
          // 16M + 3：既不是块大小的整数倍，也是显存占用最大的一个点。
          name: "n = 16777219",
          argv: ["./vadd", "16777219", "50"],
          threads: 1,
          timeLimitMs: 30000,
          maxScore: 50,
        },
      ],
    },
  },
  ui: {
    languages: ["cuda"],
    placeholder:
      "粘贴你的 kernel：实现 launch_vector_add(const float* a, const float* b, float* c, int n)",
    tags: ["CUDA", "GPU", "向量加法", "入门"],
    difficulty: "入门",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
