MPICXX   ?= mpicxx
CXXFLAGS ?= -O3 -std=c++20 -march=x86-64-v4

.PHONY: all clean

# 判题机跑的是 make all，所以选手程序必须挂在 all 下面，不能只靠驱动依赖它。
all: ring-allreduce contestant

contestant: contestant.cpp
	$(MPICXX) $(CXXFLAGS) -o $@ $<

ring-allreduce: driver.cpp
	$(MPICXX) $(CXXFLAGS) -o $@ driver.cpp

clean:
	rm -f ring-allreduce contestant
