CXX      ?= g++
CXXFLAGS ?= -O3 -std=c++20 -flto -fopenmp -pthread

all: sssp

sssp: driver.cpp contestant.cpp
	$(CXX) $(CXXFLAGS) -o $@ $^

clean:
	rm -f sssp
