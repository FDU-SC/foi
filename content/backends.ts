import { fromEnv } from "@/lib/backend/env";
import type { ProblemBackend } from "@/lib/backend/types";

export const backends: Record<string, ProblemBackend> = {
  traditional: fromEnv("traditional"),

  /** makefile 驱动的通用判题机：题目自带 makefile 与驱动，平台只传配置。 */
  interactive: fromEnv("interactive"),

  /**
   * 通用判题机：题目自带一份 sh 脚本，判题机铺好文件就跑它，再读它 stdout 上的
   * FOI_RESULT 结果行。编译、运行、比对、计分都在脚本里，所以它是"任意形态的题"
   * 的出口——代价是那道题的脚本要自己把判定写对。
   *
   * 没有 URL，和 interactive 一样：它也是主动来领活的，平台不需要知道地址。
   * 密钥取 FOI_BACKEND_COMMON_SECRET，未设置时回落到 FOI_BACKEND_SECRET。
   * 判题机侧见 foi-runners-internal 的 `common/`。
   */
  common: fromEnv("common"),

  "leaky-bucket": fromEnv("leaky-bucket"),

  /**
   * 同一个判题机的 CUDA 12.8 镜像：源码与 interactive 逐字相同，只把运行时基础镜像
   * 换成 nvidia/cuda:12.8.0（因此镜像里有 nvcc），见 foi-runners-internal 的
   * Dockerfile.cuda-12-8。
   *
   * 队列名带工具链版本，因为它确实是另一支队列：nvcc 版本影响编译产物与判题结果，
   * 而题目按 backend.id 路由——路由不到没有那套工具链的机器上。所以换 CUDA 版本是
   * 新增一支队列（在这里多一个 key、题目改 backend.id），不是同一个队列换镜像。
   *
   * 没有 URL，和 interactive 一样：它们都是主动来领活的，平台不需要知道地址。
   * 密钥取 FOI_BACKEND_INTERACTIVE_CUDA_12_8_SECRET，未设置时回落到 FOI_BACKEND_SECRET。
   */
  "interactive-cuda-12-8": fromEnv("interactive-cuda-12-8"),
};
