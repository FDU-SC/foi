"""Judges one subtask of a standard input/output problem.

argv: <subtask index>. The problem is described by foi-stdio.json and the
submission ({ language, source }) is the JSON file at $FOI_PAYLOAD.

Each test is generated on the spot: the problem's generator prints the input,
its reference solution prints the expected output, and the submission's output
is compared line by line. A subtask scores only if every test passes.

Every case of a submission shares the scratch directory, so the first case
compiles and the rest reuse the binaries, or the recorded compile error.
"""

import json
import math
import os
import re
import resource
import signal
import subprocess
import sys
import threading
import time

WORK = ".foi/stdio"
RUN_DIR = WORK + "/run"
COMPILE_ERROR = WORK + "/compile-error"
COMPILED = WORK + "/compiled"

COMPILE_TIMEOUT_S = 30
NATIVE_COMPILE_AS = 2 << 30
PRODUCE_TIMEOUT_S = 10
KILL_GRACE_S = 0.5
OUTPUT_LIMIT = 64 << 20
STDERR_TAIL = 2000
MLE_RATIO = 0.95
PREVIEW = 40

OOM = re.compile(
    r"std::bad_alloc|MemoryError|OutOfMemoryError|Cannot allocate memory|bad_array_new_length"
)

# `time` multiplies the C/C++ time limit. The largest one is mirrored in
# stdio.ts, which sizes each case's wall-clock budget from it. `entry` is the
# program's name: "main", or for Java the public class the source declares.
LANGUAGES = {
    "cpp": {
        "label": "C++",
        "source": lambda entry: "main.cpp",
        "compile": lambda entry: ["g++", "-O2", "-std=c++17", "-w", "-o", "main", "main.cpp"],
        "run": lambda entry, mb: ["./main"],
        "time": 1,
        "overhead_mb": 16,
    },
    "c": {
        "label": "C",
        "source": lambda entry: "main.c",
        "compile": lambda entry: ["gcc", "-O2", "-std=c17", "-w", "-o", "main", "main.c", "-lm"],
        "run": lambda entry, mb: ["./main"],
        "time": 1,
        "overhead_mb": 16,
    },
    "python": {
        "label": "Python",
        "source": lambda entry: "main.py",
        "compile": lambda entry: ["python3", "-m", "py_compile", "main.py"],
        "run": lambda entry, mb: ["python3", "-B", "main.py"],
        "time": 3,
        "overhead_mb": 96,
    },
    # The JVM reserves far more address space than it uses, so it is held by
    # -Xmx instead of RLIMIT_AS, and javac likewise runs without one.
    "java": {
        "label": "Java",
        "source": lambda entry: f"{entry}.java",
        "compile": lambda entry: ["javac", "-encoding", "UTF-8", "-d", ".", f"{entry}.java"],
        "run": lambda entry, mb: ["java", "-XX:+UseSerialGC", "-Xss64m", f"-Xmx{mb}m", "-cp", ".", entry],
        "time": 2,
        "overhead_mb": None,
    },
}

JAVA_PUBLIC_CLASS = re.compile(r"\bpublic\s+(?:(?:final|abstract)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)")


def entry_for(language, source):
    if language != "java":
        return "main"
    match = JAVA_PUBLIC_CLASS.search(source)
    return match.group(1) if match else "Main"


SIGNALS = {
    signal.SIGSEGV: "段错误",
    signal.SIGABRT: "主动中止",
    signal.SIGFPE: "算术异常（多半是除以零）",
    signal.SIGKILL: "被强制杀死",
    signal.SIGILL: "非法指令",
    signal.SIGBUS: "总线错误",
}


def report(score, points, status, message=None, data=None):
    result = {"score": score, "maxScore": points, "status": status}
    if message:
        result["message"] = message[:1900]
    if data is not None:
        result["data"] = data
    print("FOI_RESULT " + json.dumps(result, ensure_ascii=False))
    sys.exit(0)


def problem_bug(message):
    # No result line: the submission is disrupted rather than blamed.
    print(message, file=sys.stderr)
    sys.exit(0)


def tail(data, limit=STDERR_TAIL):
    text = data.decode("utf-8", "replace").strip()
    return text[-limit:]


def limit_to(kind, soft, hard=None):
    _, ceiling = resource.getrlimit(kind)
    hard = soft if hard is None else hard
    if ceiling != resource.RLIM_INFINITY:
        soft, hard = min(soft, ceiling), min(hard, ceiling)
    resource.setrlimit(kind, (soft, hard))


def compile_with(command, cwd, address_space):
    def apply():
        if address_space is not None:
            limit_to(resource.RLIMIT_AS, address_space)

    try:
        done = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            timeout=COMPILE_TIMEOUT_S,
            preexec_fn=apply,
        )
    except subprocess.TimeoutExpired:
        return False, f"编译超时（{COMPILE_TIMEOUT_S} 秒）"
    return done.returncode == 0, tail(done.stderr + done.stdout, 1900)


def prepare(spec, payload):
    # The diagnostics were reported with the case that compiled; repeating them
    # on every later case would repeat them in the verdict's summary too.
    if os.path.exists(COMPILE_ERROR):
        return None, None
    if os.path.exists(COMPILED):
        with open(COMPILED, encoding="utf-8") as f:
            compiled = json.load(f)
        return (LANGUAGES[compiled["language"]], compiled["entry"]), None

    os.makedirs(RUN_DIR, exist_ok=True)

    for name in ("generator", "solution"):
        ok, output = compile_with(
            ["g++", "-O2", "-std=c++17", "-o", f"{WORK}/{name}", spec[name]], ".", NATIVE_COMPILE_AS
        )
        if not ok:
            problem_bug(f"{spec[name]} 编译失败：{output}")

    language = payload.get("language") if isinstance(payload, dict) else None
    source = payload.get("source") if isinstance(payload, dict) else None

    def refuse(message):
        with open(COMPILE_ERROR, "w", encoding="utf-8") as f:
            f.write(message)
        return None, message

    if language not in spec["languages"] or language not in LANGUAGES:
        return refuse(f"本题不接受 {language} 语言的提交")
    if not isinstance(source, str) or not source.strip():
        return refuse("提交内容为空")

    lang = LANGUAGES[language]
    entry = entry_for(language, source)
    with open(os.path.join(RUN_DIR, lang["source"](entry)), "w", encoding="utf-8") as f:
        f.write(source)

    bounded = lang["overhead_mb"] is not None
    ok, output = compile_with(lang["compile"](entry), RUN_DIR, NATIVE_COMPILE_AS if bounded else None)
    if not ok:
        return refuse(output or "编译失败")

    with open(COMPILED, "w", encoding="utf-8") as f:
        json.dump({"language": language, "entry": entry}, f)
    return (lang, entry), None


def produce(binary, args, given, label):
    try:
        done = subprocess.run(
            [binary, *args], input=given, capture_output=True, timeout=PRODUCE_TIMEOUT_S
        )
    except subprocess.TimeoutExpired:
        problem_bug(f"{label}超时（{PRODUCE_TIMEOUT_S} 秒）")
    if done.returncode != 0:
        problem_bug(f"{label}退出码 {done.returncode}：{tail(done.stderr)}")
    return done.stdout


def normalize(data):
    lines = data.decode("utf-8", "replace").split("\n")
    while lines and lines[-1].strip() == "":
        lines.pop()
    return [line.rstrip() for line in lines]


def preview(line):
    if line is None:
        return "<没有这一行>"
    if len(line) <= PREVIEW:
        return json.dumps(line, ensure_ascii=False)
    return json.dumps(line[:PREVIEW], ensure_ascii=False) + "…"


def compare(got, want):
    got, want = normalize(got), normalize(want)
    for i in range(max(len(got), len(want))):
        a = got[i] if i < len(got) else None
        b = want[i] if i < len(want) else None
        if a != b:
            return f"第 {i + 1} 行不一致：期望 {preview(b)}，实际 {preview(a)}"
    return None


def run(lang, entry, given, want, limit_s, memory_mb):
    input_path, output_path, error_path = (f"{WORK}/{name}" for name in ("input", "output", "error"))
    with open(input_path, "wb") as f:
        f.write(given)

    overhead = lang["overhead_mb"]
    address_space = None if overhead is None else (memory_mb + overhead) << 20
    stack = memory_mb << 20
    cpu = math.ceil(limit_s) + 1

    def apply():
        # SIGXCPU at the soft limit, SIGKILL a second later.
        limit_to(resource.RLIMIT_CPU, cpu, cpu + 1)
        limit_to(resource.RLIMIT_STACK, stack)
        limit_to(resource.RLIMIT_FSIZE, OUTPUT_LIMIT)
        if address_space is not None:
            limit_to(resource.RLIMIT_AS, address_space)

    with open(input_path, "rb") as stdin, open(output_path, "wb") as stdout, open(
        error_path, "wb"
    ) as stderr:
        started = time.monotonic()
        child = subprocess.Popen(
            lang["run"](entry, memory_mb),
            cwd=RUN_DIR,
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            preexec_fn=apply,
            start_new_session=True,
        )
        killed = threading.Event()

        def kill():
            killed.set()
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

        timer = threading.Timer(limit_s + KILL_GRACE_S, kill)
        timer.start()
        _, status, usage = os.wait4(child.pid, 0)
        elapsed = time.monotonic() - started
        timer.cancel()
        child.returncode = os.waitstatus_to_exitcode(status)

    measured = {"time": round(elapsed * 1000), "memory": usage.ru_maxrss}
    code = child.returncode
    cpu_used = usage.ru_utime + usage.ru_stime

    if (
        killed.is_set()
        or elapsed > limit_s
        or code == -signal.SIGXCPU
        or (code == -signal.SIGKILL and cpu_used >= cpu)
    ):
        return "time_limit_exceeded", None, measured
    if code == -signal.SIGXFSZ:
        return "output_limit_exceeded", f"输出超过 {OUTPUT_LIMIT >> 20} MB", measured

    if code != 0:
        with open(error_path, "rb") as f:
            err = tail(f.read())
        near_cap = address_space is not None and usage.ru_maxrss * 1024 >= address_space * MLE_RATIO
        if near_cap or OOM.search(err):
            return "memory_limit_exceeded", None, measured
        cause = f"被信号终止：{SIGNALS.get(-code, f'signal {-code}')}" if code < 0 else f"退出码 {code}"
        lines = err.splitlines()[-3:]
        return "runtime_error", cause + ("：" + "\n".join(lines) if lines else ""), measured

    with open(output_path, "rb") as f:
        mismatch = compare(f.read(), want)
    if mismatch:
        return "wrong_answer", mismatch, measured
    return "accepted", None, measured



def main():
    with open("foi-stdio.json", encoding="utf-8") as f:
        spec = json.load(f)
    with open(os.environ["FOI_PAYLOAD"], encoding="utf-8") as f:
        payload = json.load(f)

    index = int(sys.argv[1])
    subtask = spec["subtasks"][index]
    points = subtask["score"]

    prepared, error = prepare(spec, payload)
    if prepared is None:
        report(0, points, "compile_error", error)
    lang, entry = prepared

    limit_s = spec["timeLimitMs"] * lang["time"] / 1000
    note = None
    if lang["time"] != 1 and index == 0:
        note = f"{lang['label']} 的时间限制按 {lang['time']} 倍放宽为 {round(limit_s * 1000)} ms"

    worst = {"time": 0, "memory": 0}
    for test in range(1, subtask["tests"] + 1):
        given = produce(f"{WORK}/generator", [str(index + 1), str(test), str(spec["seed"])], b"", "数据生成器")
        want = produce(f"{WORK}/solution", [], given, "标程")

        status, message, measured = run(lang, entry, given, want, limit_s, spec["memoryLimitMb"])
        worst = {key: max(worst[key], measured[key]) for key in worst}
        if status != "accepted":
            detail = f"测试点 {test}" + (f"：{message}" if message else "")
            report(0, points, status, "；".join(filter(None, [detail, note])), worst)

    report(points, points, "accepted", note, worst)


main()
