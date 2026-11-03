CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++17

# 整条 recipe 交给同一个 shell：默认每条 recipe 行都是独立 shell。
.ONESHELL:

.PHONY: all clean

# 选手提交完整程序（contestantOwnsMain: true），所以编成独立可执行文件；
# 驱动自己 exec 它，两者不链接在一起。
contestant: contestant.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<

# 驱动编译时不需要选手代码，所以 driver.cpp 单独成可执行文件。
driver.o: driver.cpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

dominator-tree: driver.o
	$(CXX) $(CXXFLAGS) -o $@ driver.o

# 判题机跑 make all，所以两个产物都要挂在这里。
all: dominator-tree contestant

clean:
	rm -f dominator-tree contestant driver.o
