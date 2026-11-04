CXX      ?= g++
CXXFLAGS ?= -O3 -std=c++20 -march=x86-64-v4 -funroll-loops

# 多线程特征。std::thread 走的是 libstdc++ 的 _ZNSt6thread 系列修饰名，不会出现
# pthread_create，所以必须按修饰名匹配：只查 pthread_create 会整整齐齐地漏掉它。
THREAD_MARKS = ^(_ZNSt6thread|_ZNSt18condition_variable|_ZNSt5mutex|_ZSt5async|_ZNSt7promise|pthread_create|GOMP_|omp_get_|__kmpc_)

# 一整条 recipe 交给同一个 shell。默认每条 recipe 行都是一个独立 shell，那样
# 带 if/|| 的多行命令必须用反斜杠续行，很容易写错且难读。
.ONESHELL:

.PHONY: all clean check-single-thread

all: perf-optimize

contestant: contestant.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<

# 前置条件里混了 phony 目标 check-single-thread，所以这里显式写文件名，
# 不能用 $^——那会把 phony 目标也当成目标文件交给 g++。
# 基线不需要单独的可执行文件：驱动本体的 --baseline 模式就是基线。
perf-optimize: driver.cpp naive.cpp check-single-thread
	$(CXX) $(CXXFLAGS) -o $@ driver.cpp naive.cpp

# 不允许并行。链接命令里没有 -pthread / -fopenmp，所以裸 pthread 与 std::thread
# 本来就链接不过；这里再查一次选手产物的动态符号表，兜住由库间接引入的线程。
check-single-thread: contestant
	@if nm -D --undefined-only contestant 2>/dev/null | awk '{print $$NF}' | grep -qE '$(THREAD_MARKS)'; then
	  echo "本题不允许使用多线程：你的程序引用了以下线程符号。" >&2
	  nm -D --undefined-only contestant | awk '{print $$NF}' | grep -E '$(THREAD_MARKS)' | sed 's/^/  引用 /' >&2
	  echo "向量化（AVX-512）是允许的，请改为单线程实现。" >&2
	  exit 1
	fi

clean:
	rm -f perf-optimize naive contestant
