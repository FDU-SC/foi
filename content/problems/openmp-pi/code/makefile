CXX      ?= g++
CXXFLAGS ?= -O3 -std=c++17 -fopenmp

all: driver contestant baseline

contestant: contestant.cpp
	$(CXX) $(CXXFLAGS) -o $@ $^

# The reference is built with the flags the statement quotes for it, so the ratio
# the contestant is scored on starts from the efficiency the problem promised
# rather than from whatever the judge defaults to.
baseline: baseline.cpp
	$(CXX) -O2 -std=c++17 -o $@ $^

driver: driver.cpp
	$(CXX) -O2 -std=c++17 -o $@ $^

clean:
	rm -f driver contestant baseline
