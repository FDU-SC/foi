#!/bin/sh
# lu 的判题脚本，跑在 common 判题机里。
#
# 判题机按 cases[] 逐个测试点跑这个脚本，工作目录就是它铺好的沙箱，里面有题目的
# driver.cpp / contestant.cpp（被选手提交覆盖）/ checker.cpp / gen.cpp / makefile。
#
# argv 依次是：
#   $1  N        矩阵规模
#   $2  t0       满分成绩（秒）——题面那张表
#   $3  u        本测试点分值
#   $4  limit    本测试点的运行时间限制（秒）——超了就是 0 分
#   $5  seed     这道提交的隐藏种子（判题机把 ${JOB_ID_SHA16} 替换进来）
#
# 评分按题面：t 为实测运行时间，得分 = min(u, u^(t0/t))，向下取整。
#
# 注意三件事，它们都是移植时踩出来的：
#   1. 判题机给单个测试点的挂钟预算（cases[].timeLimitMs）必须比题面的 limit 宽，
#      因为一个测试点里还要跑 gen 与 checker。真正的时间判定在这里做。
#   2. 选手程序与判题数据在同一个目录里，所以跑之前先记下 input 的指纹，跑完核对：
#      否则它可以把自己要解的方程组换成 A=I、b=x 的平凡方程，再输出配套的解。
#   3. 三个可执行文件只在第一个测试点编译一次，靠的是判题机让所有测试点共用同一个
#      沙箱目录；后面每个测试点都复用它们。
set -u

N=$1
T0=$2
U=$3
LIMIT=$4
SEED=${5:-42}

# 与题面一致：16 个线程并绑核。cases[].threads 必须与它一致，否则 CPU 时间预算会按
# 别的线程数算。这个数要跟宿主走：本机 16 个逻辑核，实测 8~16 线程最快，32 线程因为
# 过订阅慢一倍（33.6 → 16.0 GFLOPS）。换宿主时它与 t0 一起重新标定。
export OMP_NUM_THREADS=16
export OMP_PLACES=cores
export OMP_PROC_BIND=close

report() {
  # $1 分值 $2 状态 $3 说明
  printf 'FOI_RESULT {"score":%s,"maxScore":%s,"status":"%s","message":"%s"}\n' \
    "$1" "$U" "$2" "$3"
}

# ---------------------------------------------------------------- 编译（只做一次）
if [ ! -x solver ]; then
  say_error=$(make checker gen 2>&1)
  if [ $? -ne 0 ]; then
    msg=$(printf '%s' "$say_error" | grep -m1 -E 'error:|Error' | tr -d '"\\' | cut -c1-160)
    report 0 system_error "判题机编译 checker/gen 失败：${msg:-见 judge 日志}"
    exit 0
  fi

  build=$(make solver 2>&1)
  if [ $? -ne 0 ]; then
    # driver.cpp 是我们提供的，唯一会变的是选手的 contestant.cpp。
    msg=$(printf '%s' "$build" | grep -m1 -E 'error:' | tr -d '"\\' | cut -c1-160)
    report 0 compile_error "编译失败：${msg:-见编译输出}"
    exit 0
  fi
fi

# ---------------------------------------------------------------- 生成数据
input="input_${N}.bin"
if ! ./gen "$N" "$SEED" > gen.log 2>&1; then
  report 0 system_error "生成 N=${N} 的数据失败"
  exit 0
fi

# 选手能读写这个目录：先留指纹，跑完核对。
before=$(sha256sum "$input" | cut -d' ' -f1)

# ---------------------------------------------------------------- 跑选手程序
start=$(date +%s%N)
./solver "$input" output.bin > solver.log 2>&1
ret=$?
end=$(date +%s%N)

after=$(sha256sum "$input" | cut -d' ' -f1)
if [ "$before" != "$after" ]; then
  report 0 wrong_answer "输入数据在评测过程中被改写"
  exit 0
fi

if [ "$ret" -ne 0 ]; then
  tail_msg=$(tail -n 1 solver.log | tr -d '"\\' | cut -c1-120)
  report 0 runtime_error "solver 退出码 ${ret}：${tail_msg}"
  exit 0
fi

if [ ! -f output.bin ]; then
  report 0 wrong_answer "没有产出 output.bin"
  exit 0
fi

# 秒，六位小数；镜像里没有 bc，用 awk。
t=$(awk -v ns="$((end - start))" 'BEGIN{printf "%.6f", ns/1000000000}')

if [ "$(awk -v t="$t" -v l="$LIMIT" 'BEGIN{print (t > l) ? 1 : 0}')" = "1" ]; then
  report 0 time_limit_exceeded "N=${N} 用时 ${t}s，超过 ${LIMIT}s 的限制"
  rm -f "$input" output.bin solver.log gen.log
  exit 0
fi

# ---------------------------------------------------------------- 验正确性
if ! ./checker "$input" output.bin > checker.log 2>&1; then
  err=$(awk '/Relative Error/{print $4}' checker.log)
  report 0 wrong_answer "相对残差 ${err:-未知} 超过 1e-5（N=${N}，用时 ${t}s）"
  rm -f "$input" output.bin solver.log checker.log gen.log
  exit 0
fi

# ---------------------------------------------------------------- 按题面给分
err=$(awk '/Relative Error/{print $4}' checker.log)
gflops=$(awk '/GFLOPS/{print $2}' solver.log)
score=$(awk -v u="$U" -v t0="$T0" -v t="$t" \
  'BEGIN{s = exp(log(u) * t0 / t); if (s > u) s = u; print int(s)}')

status=partial
[ "$score" -ge "$U" ] && status=accepted
report "$score" "$status" \
  "N=${N} 用时 ${t}s（满分成绩 ${T0}s，上限 ${LIMIT}s），相对残差 ${err:-?}，${gflops:-?} GFLOPS"

# 数据文件很大（N=8192 时 512 MB），下一个测试点会自己重新生成。
rm -f "$input" output.bin solver.log checker.log gen.log
