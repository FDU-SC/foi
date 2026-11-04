
CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++17 -include api.h

all: driver

driver: driver.cpp contestant.cpp
	$(CXX) $(CXXFLAGS) -o $@ $^

clean:
	rm -f driver
