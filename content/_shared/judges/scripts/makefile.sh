#!/bin/sh
# Builds the problem with make once per submission, then runs this case's command.
#
# argv: <maxScore> <runAddressSpaceKb|unbounded> <ownsMain 0|1> <target|-> <artifact> <contestant> <command...>
#
# Every case of a submission shares the scratch directory, so the first case
# builds and the rest reuse the artifact, or the recorded compile error.
set -u

points=$1
address_space=$2
owns_main=$3
target=$4
artifact=$5
contestant=$6
shift 6

mkdir -p .foi

# The message is truncated at the head: the first diagnostics are the useful ones.
as_json() {
  python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()[:1900]))'
}

compile_error() {
  touch .foi/build-error
  printf 'FOI_RESULT {"score":0,"maxScore":%s,"status":"compile_error","message":%s}\n' \
    "$points" "$(printf '%s' "$1" | as_json)"
  exit 0
}

# The diagnostics were reported with the case that built; repeating them on
# every later case would repeat them in the verdict's summary too.
if [ -f .foi/build-error ]; then
  printf 'FOI_RESULT {"score":0,"maxScore":%s,"status":"compile_error"}\n' "$points"
  exit 0
fi

if [ ! -f .foi/built ]; then
  if [ "$owns_main" = 0 ] &&
    grep -Eq '(^|[^A-Za-z0-9_])int[[:space:]]+main[[:space:]]*[(]' "$contestant"; then
    compile_error "本题只提交实现：main() 由评测驱动提供，请不要自己定义"
  fi

  if [ "$target" = - ]; then
    output=$(make 2>&1)
  else
    output=$(make "$target" 2>&1)
  fi
  [ $? -eq 0 ] || compile_error "$output"

  # make can succeed without producing the artifact. That is the problem's bug:
  # exit without a result line so the submission is disrupted, not failed.
  if [ ! -e "$artifact" ]; then
    echo "make 成功，但没有产出 $artifact" >&2
    exit 0
  fi
  touch .foi/built
fi

# The build gets the larger budget; the problem's own run budget starts here.
[ "$address_space" = unbounded ] || ulimit -v "$address_space"
exec "$@"
