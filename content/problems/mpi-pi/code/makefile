MPICXX   ?= mpicxx
CXXFLAGS ?= -O3 -std=c++20 -march=x86-64-v4 -funroll-loops

# 多线程特征。std::thread 走的是 libstdc++ 的 _ZNSt6thread 系列修饰名，不会出现
# pthread_create，所以必须按修饰名匹配：只查 pthread_create 会整整齐齐地漏掉它。
THREAD_MARKS = ^(_ZNSt6thread|_ZNSt18condition_variable|_ZNSt5mutex|_ZSt5async|_ZNSt7promise|pthread_create|GOMP_|omp_get_|__kmpc_)

# 一整条 recipe 交给同一个 shell。默认每条 recipe 行都是一个独立 shell，那样
# 带 if/|| 的多行命令必须用反斜杠续行，很容易写错且难读。
.ONESHELL:

.PHONY: all clean check-single-thread

all: driver

baseline: baseline.cpp
	$(MPICXX) $(CXXFLAGS) -o $@ $<

contestant: contestant.cpp
	$(MPICXX) $(CXXFLAGS) -o $@ $<

# 前置条件里混了 phony 目标 check-single-thread，所以这里显式写文件名，
# 不能用 $^——那会把 phony 目标也当成目标文件交给 mpicxx。
driver: driver.cpp baseline check-single-thread
	$(MPICXX) $(CXXFLAGS) -o $@ driver.cpp

# 每个 rank 内部必须是单线程，并行只能来自 MPI rank。
check-single-thread: contestant
	@if nm -D --undefined-only contestant 2>/dev/null | awk '{print $$NF}' | grep -qE '$(THREAD_MARKS)'; then
	  echo "每个 rank 内部不允许再开线程（没有 -fopenmp / -pthread），并行只能来自 MPI rank。" >&2
	  nm -D --undefined-only contestant | awk '{print $$NF}' | grep -E '$(THREAD_MARKS)' | sed 's/^/  引用 /' >&2
	  exit 1
	fi

clean:
	rm -f driver baseline contestant
