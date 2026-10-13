import { describe, expect, it } from "vitest";
import {
  decodeJudgeFile,
  encodeJudgeBytes,
  judgeFileProblem,
  judgePathProblem,
  type JudgeFile,
} from "./judge-file";

/**
 * The rules a stored judge file has to satisfy.
 *
 * A repository problem gets these from reading its `code/` directory off disk —
 * the bytes are there to compare against. An authored one has been through a
 * browser and a JSON body by the time it is stored, so what is checked is the
 * claim about the bytes rather than the bytes themselves.
 */

describe("判题文件的路径", () => {
  it.each([
    ["run.sh", null],
    ["tests/1.in", null],
    ["include/deep/api.h", null],
    ["MAKEFILE", null],
    ["a.b.c", null],
  ])("%s 可以存", (path, expected) => {
    expect(judgePathProblem(path)).toBe(expected);
  });

  it.each([
    ["", /不能为空/],
    ["/etc/passwd", /相对路径/],
    ["C:/windows/x", /相对路径/],
    ["a\\b", /正斜杠/],
    ["a//b", /空段/],
    ["../escape", /空段|\.\./],
    ["./run.sh", /空段|\./],
    ["a/../b", /\.\./],
  ])("%s 不能存", (path, message) => {
    expect(judgePathProblem(path)).toMatch(message);
  });

  it.each([
    [".env", /\.env/],
    ["config/.env.local", /\.env/],
    ["key.pem", /密钥/],
    ["tls/server.key", /密钥/],
    ["id_rsa", /私钥/],
    [".ssh/config", /\.ssh/],
    [".git/config", /\.git/],
    ["home/.netrc", /凭据/],
    ["deploy/credentials", /凭据/],
  ])("%s 是凭据或版本库，必须拒绝", (path, message) => {
    expect(judgePathProblem(path)).toMatch(message);
  });
});

describe("判题文件的正文", () => {
  const file = (path: string, content: string, encoding?: "base64"): JudgeFile =>
    encoding === undefined ? { path, content } : { path, content, encoding };

  it("文本与 base64 都能无损还原", () => {
    const text = encodeJudgeBytes(Buffer.from("#!/bin/sh\necho hi\n", "utf8"));
    expect(text.encoding).toBeUndefined();
    expect(decodeJudgeFile({ path: "run.sh", ...text }).toString("utf8")).toBe(
      "#!/bin/sh\necho hi\n",
    );

    const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41]);
    const binary = encodeJudgeBytes(bytes);
    expect(binary.encoding).toBe("base64");
    expect(decodeJudgeFile({ path: "data.bin", ...binary }).equals(bytes)).toBe(true);
  });

  it("含 NUL 的字节仍算文本，因为它能原样往返", () => {
    const bytes = Buffer.from("hello\u0000world", "utf8");
    expect(encodeJudgeBytes(bytes).encoding).toBeUndefined();
  });

  it("空文件被拒绝，评测机不接受空的 content", () => {
    expect(judgeFileProblem(file("contestant.cpp", ""))).toMatch(/内容为空/);
  });

  it("声明 base64 就必须是合法 base64", () => {
    expect(judgeFileProblem(file("data.bin", "bm90IGJhc2U2NCBxdWl0ZQ==", "base64"))).toBeNull();
    expect(judgeFileProblem(file("data.bin", "!!!not base64!!!", "base64"))).toMatch(
      /不是合法的 base64/,
    );
  });

  it("文本里出现替换字符就是二进制被当成文本读了", () => {
    expect(judgeFileProblem(file("data.bin", "a\uFFFDb"))).toMatch(/U\+FFFD/);
  });

  it("路径不合格时先报路径", () => {
    expect(judgeFileProblem(file("../x", "y"))).toMatch(/\.\./);
  });
});
