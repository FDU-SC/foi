# Builds the three binaries the judge needs. Keep these flags in step with the
# statement: contestants compile the same way locally.
CC = g++
CFLAGS = -O3 -Wall -march=native -std=c++17 -fopenmp
LDFLAGS = -lm -fopenmp

all: solver checker gen

solver: driver.cpp contestant.cpp
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

checker: checker.cpp
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

gen: gen.cpp
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

clean:
	rm -f solver checker gen input_*.bin output.bin

.PHONY: all clean
